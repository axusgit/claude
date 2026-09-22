"""One-way import of Xcitium Service Desk into the read-only mirror tables.

Strategy (this instance has no user/customer/all-tickets list endpoint):
  * `viewticket` is admin-scoped and keyed by a sequential ticket id, so we sweep
    ids. Each ticket carries its user {id,name,email,organizationName} and full
    comment threads, so customers + users are derived from the ticket sweep.
  * Ceiling is found by scanning until CONSEC_MISS_STOP consecutive missing ids
    (deleted/gap ids are isolated; a long run of misses means past the end).

Entry points:
  * backfill()      -- full historical import (sweep from id 1)
  * incremental()   -- import new ids past the high-water mark + re-sync open tickets
  * run_scheduler() -- daemon loop that runs incremental at the top of every hour

CLI:  python -m app.xcitium_sync {backfill|incremental|status|discover}
"""
import json
import os
import time
import threading
from datetime import datetime

from sqlalchemy import func

from app.database import SessionLocal
from app.models.xcitium import (
    XcitiumCustomer, XcitiumUser, XcitiumTicket, XcitiumThread, XcitiumSyncState,
    XcitiumDirectoryTombstone,
)
from app import xcitium

CONSEC_MISS_STOP = 100    # consecutive 404s that mean "past the last ticket"
COMMIT_EVERY = 50
OPEN_STATUSES = ("open", "in_progress", "waiting", "reopened", "assigned")

# Xcitium system/automation accounts (not real people) to exclude from the user
# directory import. Matched case-insensitively against the Xcitium user name.
# An already-imported row for one of these is soft-deactivated on the next run
# (its uid falls out of seen_uids, so deletion reconciliation hides it).
EXCLUDED_USER_NAMES = {"patch management agent"}

# Rewrite dead/old requester emails to their current address on import, so mirrored
# tickets show the person's live email on the Axus Service Desk. Keys are lower-case.
# Extend via env XCITIUM_EMAIL_REMAP="old1=new1,old2=new2". Re-applied every sync.
EMAIL_REMAP = {
    "acarrazana@axustechnologies.com": "acarr@axustechnologies.com",
    "abos@hcnetwork.org": "asabor@hcnetwork.org",
}
for _pair in os.getenv("XCITIUM_EMAIL_REMAP", "").split(","):
    if "=" in _pair:
        _old, _new = _pair.split("=", 1)
        if _old.strip() and _new.strip():
            EMAIL_REMAP[_old.strip().lower()] = _new.strip()


def _remap_email(email):
    if not email:
        return email
    return EMAIL_REMAP.get(email.strip().lower(), email)


# Rename Xcitium organizations to their Axus business name on import, so mirrored
# tickets + auto-created clients use the current name and the old name is never
# re-created. Keys are lower-case. Extend via env XCITIUM_ORG_REMAP="old=new,...".
ORG_REMAP = {
    "chcp": "Evara Health",
}
for _pair in os.getenv("XCITIUM_ORG_REMAP", "").split(","):
    if "=" in _pair:
        _o, _n = _pair.split("=", 1)
        if _o.strip() and _n.strip():
            ORG_REMAP[_o.strip().lower()] = _n.strip()


def _remap_org(org):
    if not org:
        return org
    return ORG_REMAP.get(org.strip().lower(), org)


# ---------- helpers ----------

def _parse_dt(s):
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except (ValueError, TypeError):
            continue
    return None


def _state(db) -> XcitiumSyncState:
    st = db.query(XcitiumSyncState).filter(XcitiumSyncState.id == 1).first()
    if not st:
        st = XcitiumSyncState(id=1, max_ticket_id=0, high_water_id=0, tickets_total=0)
        db.add(st)
        db.commit()
        db.refresh(st)
    return st


def _upsert_customer(db, name):
    name = (name or "").strip()
    if not name:
        return
    c = db.query(XcitiumCustomer).filter(XcitiumCustomer.name == name).first()
    if c:
        c.last_synced_at = datetime.utcnow()
    else:
        db.add(XcitiumCustomer(name=name))
        # flush so a repeat of this name later in the same (autoflush=False)
        # transaction finds the pending row instead of inserting a duplicate
        db.flush()


def _upsert_user(db, u):
    if not u or not u.get("id"):
        return
    ext = str(u["id"])
    row = db.query(XcitiumUser).filter(XcitiumUser.external_id == ext).first()
    if not row:
        row = XcitiumUser(external_id=ext)
        db.add(row)
        db.flush()
    row.name = u.get("name")
    row.email = _remap_email(u.get("email"))
    row.organization_name = (u.get("organizationName") or "").strip() or None
    row.last_synced_at = datetime.utcnow()


def _import_ticket(db, data) -> None:
    """Upsert one XcitiumTicket + replace its threads from a viewticket payload."""
    ext = int(data["ticketId"])
    user = data.get("user") or {}
    org = _remap_org((user.get("organizationName") or "").strip() or None)
    threads = data.get("threads") or []

    t = db.query(XcitiumTicket).filter(XcitiumTicket.external_id == ext).first()
    if not t:
        t = XcitiumTicket(external_id=ext)
        db.add(t)

    t.subject = data.get("subject")
    t.status = data.get("status")
    t.priority = data.get("priority")
    t.department = data.get("department")
    t.category = data.get("category")
    t.asset = data.get("asset")
    t.device_name = data.get("deviceName")
    assignee = data.get("assignee")
    t.assignee = None if assignee in (False, None) else str(
        assignee if not isinstance(assignee, dict) else assignee.get("name") or assignee
    )
    t.username = data.get("username")
    t.user_external_id = str(user["id"]) if user.get("id") else None
    t.user_email = _remap_email(user.get("email"))
    t.organization_name = org
    t.create_date = _parse_dt(data.get("createDate"))
    t.update_date = _parse_dt(data.get("updateDate"))
    t.last_message = _parse_dt(data.get("lastMessage"))
    t.last_response = _parse_dt(data.get("lastResponse"))
    t.last_resolution = data.get("lastResolution")
    t.thread_count = len(threads)
    t.raw_json = json.dumps(data, ensure_ascii=False)

    # replace threads (source has no per-message id, so rewrite in order)
    db.query(XcitiumThread).filter(XcitiumThread.ticket_external_id == ext).delete()
    for i, th in enumerate(threads):
        db.add(XcitiumThread(
            ticket_external_id=ext, seq=i,
            created=_parse_dt(th.get("created")),
            poster=th.get("poster"), title=th.get("title"), body=th.get("body"),
        ))

    _upsert_user(db, user)
    _upsert_customer(db, org)


def _sync_one(db, tid) -> str:
    """Return 'imported' | 'missing' | 'error' for a single ticket id."""
    try:
        data = xcitium.viewticket(tid)
    except xcitium.XcitiumError as e:
        print(f"[xcitium] ticket {tid} error: {e}", flush=True)
        return "error"
    if data is None:
        return "missing"
    _import_ticket(db, data)
    return "imported"


def _sweep_from(db, start_id, stop_on_consecutive_misses=CONSEC_MISS_STOP):
    """Sweep ids upward from start_id until a long run of misses. Returns
    (imported, last_existing_id)."""
    st = _state(db)
    imported = 0
    misses = 0
    last_hit = st.max_ticket_id
    tid = start_id
    while misses < stop_on_consecutive_misses:
        outcome = _sync_one(db, tid)
        if outcome == "imported":
            imported += 1
            misses = 0
            last_hit = tid
            if tid > st.high_water_id:
                st.high_water_id = tid
            if tid > st.max_ticket_id:
                st.max_ticket_id = tid
        elif outcome == "missing":
            misses += 1
        else:  # error -- leave the id to be retried next run, keep going
            misses += 1
        if imported and imported % COMMIT_EVERY == 0 and outcome == "imported":
            db.commit()
            print(f"[xcitium] imported {imported} (through id {tid})", flush=True)
        tid += 1
    db.commit()
    return imported, last_hit


# ---------- public entry points ----------

def backfill():
    """Full historical import, sweeping from id 1."""
    if not xcitium.is_configured():
        return {"configured": False}
    db = SessionLocal()
    started = datetime.utcnow()
    try:
        st = _state(db)
        st.running = True
        st.last_run_status = "backfill running"
        db.commit()
        imported, last = _sweep_from(db, 1)
        try:
            import_directory()
        except Exception as e:
            print(f"[xcitium] directory import failed during backfill: {e}", flush=True)
        st = _state(db)
        st.tickets_total = db.query(XcitiumTicket).count()
        st.running = False
        st.last_run_at = datetime.utcnow()
        st.last_full_backfill_at = datetime.utcnow()
        st.last_run_status = f"backfill ok: {imported} imported, {st.tickets_total} total"
        db.commit()
        secs = (datetime.utcnow() - started).total_seconds()
        print(f"[xcitium] backfill complete: {st.tickets_total} tickets in {secs:.0f}s", flush=True)
        return {"configured": True, "imported": imported, "total": st.tickets_total}
    except Exception as e:
        db.rollback()
        st = _state(db); st.running = False; st.last_run_status = f"backfill error: {e}"
        db.commit()
        raise
    finally:
        db.close()


def incremental():
    """Import ids past the high-water mark, then re-sync still-open tickets."""
    if not xcitium.is_configured():
        return {"configured": False}
    db = SessionLocal()
    try:
        st = _state(db)
        if st.high_water_id == 0 and db.query(XcitiumTicket).count() == 0:
            db.close()
            return backfill()   # first ever run -> full backfill
        st.running = True
        st.last_run_status = "incremental running"
        db.commit()

        new_imported, _ = _sweep_from(db, st.high_water_id + 1)

        # re-sync open tickets to catch status changes / new replies
        open_ids = [r.external_id for r in db.query(XcitiumTicket.external_id)
                    .filter(XcitiumTicket.status.in_(OPEN_STATUSES)).all()]
        refreshed = 0
        for ext in open_ids:
            if _sync_one(db, ext) == "imported":
                refreshed += 1
            if refreshed and refreshed % COMMIT_EVERY == 0:
                db.commit()
        db.commit()

        try:
            import_directory()
        except Exception as e:
            print(f"[xcitium] directory import failed during incremental: {e}", flush=True)

        st = _state(db)
        st.tickets_total = db.query(XcitiumTicket).count()
        st.running = False
        st.last_run_at = datetime.utcnow()
        st.last_run_status = f"incremental ok: {new_imported} new, {refreshed} refreshed"
        db.commit()
        print(f"[xcitium] incremental: {new_imported} new, {refreshed} refreshed, "
              f"{st.tickets_total} total", flush=True)
        return {"configured": True, "new": new_imported, "refreshed": refreshed,
                "total": st.tickets_total}
    except Exception as e:
        db.rollback()
        st = _state(db); st.running = False; st.last_run_status = f"incremental error: {e}"
        db.commit()
        raise
    finally:
        db.close()


def status():
    db = SessionLocal()
    try:
        st = _state(db)
        return {
            "configured": xcitium.is_configured(),
            "tickets_total": db.query(XcitiumTicket).count(),
            "customers": db.query(XcitiumCustomer).count(),
            "users": db.query(XcitiumUser).count(),
            "high_water_id": st.high_water_id,
            "max_ticket_id": st.max_ticket_id,
            "running": st.running,
            "last_run_at": st.last_run_at.isoformat() if st.last_run_at else None,
            "last_run_status": st.last_run_status,
            "last_full_backfill_at": (st.last_full_backfill_at.isoformat()
                                      if st.last_full_backfill_at else None),
            "directory": _directory_counts(db),
        }
    finally:
        db.close()


def _directory_counts(db):
    from app.models.client import Client
    from app.models.user import User
    return {
        "customers_imported": db.query(Client).filter(Client.source == "xcitium").count(),
        "users_imported": db.query(User).filter(User.source == "xcitium").count(),
        "users_unassigned": db.query(User).filter(
            User.source == "xcitium", User.client_id.is_(None)).count(),
    }


def _domain_of(email):
    email = (email or "").strip().lower()
    return email.rsplit("@", 1)[-1] if "@" in email else None


# Domain-fallback tuning: a domain is auto-linked to a customer only when a single
# customer accounts for at least this share of that domain's ticket volume. Genuinely
# shared domains (e.g. @hcnetwork.org, used by multiple distinct HCN member orgs) fall
# below this and are left unassigned + reported rather than silently misassigned.
DOMAIN_DOMINANT_SHARE = 0.85


def _org_by_domain(db):
    """Learn email-domain -> customer from tickets that carry BOTH a user email and
    an organization. Returns (confident_map, ambiguous) where confident_map[domain] is
    the winning org and ambiguous[domain] = {org: count} for domains with no dominant
    org (shared domains). Free/generic mailbox domains are never mapped."""
    from collections import Counter
    GENERIC = {
        "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
        "aol.com", "live.com", "msn.com", "protonmail.com",
        "microsoft.com", "communication.microsoft.com", "outlook.mail.microsoft",
    }
    domain_orgs = {}
    rows = (db.query(XcitiumTicket.user_email, XcitiumTicket.organization_name)
            .filter(XcitiumTicket.user_email.isnot(None),
                    XcitiumTicket.organization_name.isnot(None)).all())
    for email, org in rows:
        dom = _domain_of(email)
        org = (org or "").strip()
        if not dom or not org or dom in GENERIC:
            continue
        domain_orgs.setdefault(dom, Counter())[org] += 1

    confident, ambiguous = {}, {}
    for dom, orgs in domain_orgs.items():
        total = sum(orgs.values())
        org, cnt = orgs.most_common(1)[0]
        if len(orgs) == 1 or cnt / total >= DOMAIN_DOMINANT_SHARE:
            confident[dom] = org
        else:
            ambiguous[dom] = dict(orgs)
    return confident, ambiguous


def import_directory():
    """Import the Xcitium User Directory (customer end users) and their customers
    into the native clients/users tables (tagged source='xcitium').

    - Customers = the organizations seen on imported tickets -> native Client rows.
    - Users = every entry from getUsers, created as role='client' and linked to
      their customer via the org on their tickets. Users with no tickets of their own
      are linked by EMAIL DOMAIN when that domain maps unambiguously to one customer
      (learned from the ticket-linked users); otherwise left unassigned (client_id
      NULL). Native users (e.g. staff) are never relinked/downgraded -- only tagged
      with their xcitium id.
    """
    if not xcitium.is_configured():
        return {"configured": False}
    from app.models.client import Client
    from app.models.user import User, UserRole
    db = SessionLocal()
    try:
        # org name per Xcitium user id, from imported tickets
        org_by_uid = {}
        for uid, org in (db.query(XcitiumTicket.user_external_id, XcitiumTicket.organization_name)
                         .filter(XcitiumTicket.user_external_id.isnot(None),
                                 XcitiumTicket.organization_name.isnot(None)).distinct().all()):
            if uid and (org or "").strip():
                org_by_uid[str(uid)] = _remap_org(org.strip())

        # email-domain -> customer, learned from ticket-linked users (for the
        # ticketless users that have no org of their own)
        org_by_domain, ambiguous_domains = _org_by_domain(db)

        # ensure a native Client for every org we might link to (ticket orgs +
        # confident domain-mapped orgs -- the latter is a subset in practice)
        all_orgs = set(org_by_uid.values()) | set(org_by_domain.values())
        client_id_by_org = {}
        clients_created = 0
        for org in sorted(all_orgs):
            c = db.query(Client).filter(Client.company_name == org).first()
            if not c:
                c = Client(company_name=org, contact_name="", email="", source="xcitium")
                db.add(c); db.flush(); clients_created += 1
            client_id_by_org[org] = c.id
        db.commit()

        users = xcitium.get_users()
        # Drop system/automation accounts (e.g. "Patch Management Agent") before
        # anything else, so they are never created here and any previously-imported
        # row is left out of seen_uids -> soft-deactivated by reconciliation below.
        excluded_names = 0
        _filtered = []
        for u in users:
            if (u.get("name") or "").strip().lower() in EXCLUDED_USER_NAMES:
                excluded_names += 1
                continue
            _filtered.append(u)
        users = _filtered
        # Tombstones: identities deleted in the Axus Service Desk are authoritative
        # and must never be re-created here (matched by email or Xcitium user id).
        tomb_emails = {r[0] for r in db.query(XcitiumDirectoryTombstone.email).all()}
        tomb_uids = {r[0] for r in db.query(XcitiumDirectoryTombstone.xcitium_user_id)
                     .filter(XcitiumDirectoryTombstone.xcitium_user_id.isnot(None)).all()}

        # ADDITIVE-ONLY: create genuinely new customers; never modify or deactivate an
        # existing native record (name / company / role / active are managed in Axus,
        # not synced from Xcitium), and never resurrect a tombstoned (deleted) one.
        created = existing = tombstoned = skipped = linked = 0
        for u in users:
            email = _remap_email((u.get("address") or "").strip()).lower()  # retire dead emails
            uid = str(u.get("id") or "").strip()
            name = (u.get("name") or "").strip() or email or "Unknown"
            if not email:
                skipped += 1
                continue
            if email in tomb_emails or (uid and uid in tomb_uids):
                tombstoned += 1
                continue
            if db.query(User).filter(User.email == email).first():
                existing += 1
                continue
            org = org_by_uid.get(uid) or org_by_domain.get(_domain_of(email))
            client_id = client_id_by_org.get(org) if org else None
            linked += 1 if client_id else 0
            db.add(User(email=email, full_name=name, hashed_password="",
                        role="client", client_id=client_id,
                        source="xcitium", xcitium_user_id=uid))
            db.flush(); created += 1
            if created % 100 == 0:
                db.commit()
        db.commit()

        result = {"configured": True, "clients_created": clients_created,
                  "users_seen": len(users), "created": created,
                  "existing_untouched": existing, "tombstoned_skipped": tombstoned,
                  "linked_new": linked, "skipped_no_email": skipped,
                  "excluded_names": excluded_names,
                  "ambiguous_domains": ambiguous_domains}
        print(f"[xcitium] directory import: {result}", flush=True)
        return result
    except Exception as e:
        db.rollback()
        print(f"[xcitium] directory import error: {e}", flush=True)
        raise
    finally:
        db.close()


def apply_email_remap():
    """Rewrite mirrored requester emails per EMAIL_REMAP across all existing rows.
    Idempotent; used for the one-time fix of already-imported tickets (new/re-synced
    tickets are remapped at import time by _import_ticket)."""
    db = SessionLocal()
    total = 0
    try:
        for old, new in EMAIL_REMAP.items():
            t = (db.query(XcitiumTicket).filter(func.lower(XcitiumTicket.user_email) == old)
                 .update({XcitiumTicket.user_email: new}, synchronize_session=False))
            u = (db.query(XcitiumUser).filter(func.lower(XcitiumUser.email) == old)
                 .update({XcitiumUser.email: new}, synchronize_session=False))
            if t or u:
                print(f"[xcitium] email remap {old} -> {new}: {t} tickets, {u} users", flush=True)
            total += t + u
        db.commit()
        return {"remapped_rows": total, "map": EMAIL_REMAP}
    finally:
        db.close()


def apply_org_remap():
    """Rename Xcitium orgs to their Axus business name per ORG_REMAP: the native
    Client (repointing users/tickets and merging if the target name already exists),
    the mirrored ticket orgs, and the xcitium_customers dimension. Idempotent."""
    from app.models.client import Client
    from app.models.user import User
    from app.models.ticket import Ticket
    db = SessionLocal()
    total = 0
    try:
        for old, new in ORG_REMAP.items():
            new_client = (db.query(Client)
                          .filter(func.lower(Client.company_name) == new.lower()).first())
            old_clients = (db.query(Client)
                           .filter(func.lower(Client.company_name) == old).all())
            for oc in old_clients:
                if new_client and oc.id != new_client.id:
                    # merge into the existing target business
                    db.query(User).filter(User.client_id == oc.id).update(
                        {User.client_id: new_client.id}, synchronize_session=False)
                    db.query(Ticket).filter(Ticket.client_id == oc.id).update(
                        {Ticket.client_id: new_client.id}, synchronize_session=False)
                    db.delete(oc)
                else:
                    oc.company_name = new
                    new_client = oc
                total += 1
            t = (db.query(XcitiumTicket).filter(func.lower(XcitiumTicket.organization_name) == old)
                 .update({XcitiumTicket.organization_name: new}, synchronize_session=False))
            # xcitium_customers.name is unique: drop the old row if the target exists
            if db.query(XcitiumCustomer).filter(func.lower(XcitiumCustomer.name) == new.lower()).first():
                db.query(XcitiumCustomer).filter(func.lower(XcitiumCustomer.name) == old).delete(
                    synchronize_session=False)
            else:
                db.query(XcitiumCustomer).filter(func.lower(XcitiumCustomer.name) == old).update(
                    {XcitiumCustomer.name: new}, synchronize_session=False)
            if t:
                print(f"[xcitium] org remap {old} -> {new}: {t} tickets", flush=True)
            total += t
        db.commit()
        return {"remapped_rows": total, "map": ORG_REMAP}
    finally:
        db.close()


# ---------- top-of-hour scheduler ----------

def _seconds_to_next_hour() -> float:
    now = time.time()
    return 3600 - (now % 3600)


def run_scheduler():
    """Daemon loop: backfill once if the mirror is empty, then run incremental at
    the top of every hour. Exceptions are swallowed so the loop survives a bad run
    (e.g. the Xcitium API being down, as it was on 2026-09-14)."""
    try:
        apply_email_remap()   # keep requester-email remaps applied across restarts
        apply_org_remap()     # keep business renames applied across restarts
    except Exception as e:
        print(f"[xcitium] email remap failed: {e}", flush=True)
    try:
        db = SessionLocal()
        empty = db.query(XcitiumTicket).count() == 0
        db.close()
        if empty:
            print("[xcitium] mirror empty -> initial backfill", flush=True)
            try:
                backfill()
            except Exception as e:
                print(f"[xcitium] initial backfill failed (will retry hourly): {e}", flush=True)
    except Exception:
        pass

    while True:
        time.sleep(_seconds_to_next_hour())
        try:
            incremental()
        except Exception as e:
            print(f"[xcitium] hourly sync failed: {e}", flush=True)


def start_scheduler_thread():
    threading.Thread(target=run_scheduler, daemon=True, name="xcitium-sync").start()


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "backfill":
        print(json.dumps(backfill(), indent=2))
    elif cmd == "incremental":
        print(json.dumps(incremental(), indent=2))
    elif cmd == "directory":
        print(json.dumps(import_directory(), indent=2))
    elif cmd == "status":
        print(json.dumps(status(), indent=2))
    elif cmd == "remap":
        print(json.dumps(apply_email_remap(), indent=2))
    elif cmd == "org-remap":
        print(json.dumps(apply_org_remap(), indent=2))
    else:
        print("usage: python -m app.xcitium_sync {backfill|incremental|directory|status|remap|org-remap}")

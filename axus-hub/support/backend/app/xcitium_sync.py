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
import time
import threading
from datetime import datetime

from app.database import SessionLocal
from app.models.xcitium import (
    XcitiumCustomer, XcitiumUser, XcitiumTicket, XcitiumThread, XcitiumSyncState,
)
from app import xcitium

CONSEC_MISS_STOP = 100    # consecutive 404s that mean "past the last ticket"
COMMIT_EVERY = 50
OPEN_STATUSES = ("open", "in_progress", "waiting", "reopened", "assigned")


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
    row.email = u.get("email")
    row.organization_name = (u.get("organizationName") or "").strip() or None
    row.last_synced_at = datetime.utcnow()


def _import_ticket(db, data) -> None:
    """Upsert one XcitiumTicket + replace its threads from a viewticket payload."""
    ext = int(data["ticketId"])
    user = data.get("user") or {}
    org = (user.get("organizationName") or "").strip() or None
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
    t.user_email = user.get("email")
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
        }
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
    elif cmd == "status":
        print(json.dumps(status(), indent=2))
    else:
        print("usage: python -m app.xcitium_sync {backfill|incremental|status}")

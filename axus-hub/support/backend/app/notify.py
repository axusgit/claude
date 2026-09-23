"""Staff email notifications for ticket events, sent from support@axustechnologies.com
via app.mailer (the O365 SMTP relay).

Events:
  * new ticket   -> the assignee if assigned at creation, otherwise all active staff
  * assignment   -> the newly assigned staff member
  * customer reply -> the assignee (or all staff if unassigned, so nobody is left waiting)

All functions are best-effort and swallow their own errors, so they are safe to run
as FastAPI BackgroundTasks or from the email-poller thread. Disable with NOTIFY_ENABLED=0.
"""
import os

from app.database import SessionLocal
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app import mailer

# System/automation accounts that should never receive notifications.
SYS_EMAILS = {"email-intake@axustechnologies.com"}
STAFF_ROLES = (UserRole.admin, UserRole.technician)
# Every new ticket is also emailed here (the ticket intake inbox).
NEW_TICKET_INBOX = os.getenv("NEW_TICKET_INBOX", "info@axustechnologies.com")


def _client_allowlist():
    """Pre-production guard: when CLIENT_NOTIFY_ALLOW is set, client-facing emails
    go ONLY to those addresses (staff emails are never affected). Empty/unset = no
    restriction (production behaviour)."""
    raw = (os.getenv("CLIENT_NOTIFY_ALLOW") or "").strip()
    if not raw:
        return None
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def client_blocked(email) -> bool:
    allow = _client_allowlist()
    return allow is not None and (email or "").lower() not in allow


def _enabled() -> bool:
    return os.getenv("NOTIFY_ENABLED", "1") == "1" and mailer.is_configured()


def _to(recips):
    """Soft-launch guard: if NOTIFY_ONLY is set, every notification is redirected to
    that single address instead of the computed recipients. Set it empty to fan out
    to the whole team. Returns the (possibly overridden) recipient list."""
    only = (os.getenv("NOTIFY_ONLY") or "").strip()
    if only:
        return [only]
    return recips


def _ticket_url() -> str:
    # Staff app lives on the clean service domain (STAFF_URL overrides).
    return (os.getenv("STAFF_URL") or "https://service.axustechnologies.com/staff").strip()


def _v(x):
    return x.value if hasattr(x, "value") else x


def _staff_emails(db, exclude_id=None):
    # Accounts parked in the hidden "Dummy Business" (e.g. the Authentik default
    # admin) never receive staff notifications.
    from app.models.client import Client
    hidden = {c.id for c in db.query(Client.id).filter(Client.company_name == "Dummy Business").all()}
    out = set()
    for u in db.query(User).filter(User.role.in_(STAFF_ROLES), User.is_active == True).all():  # noqa: E712
        if (u.id == exclude_id or not u.email or u.email.lower() in SYS_EMAILS
                or u.client_id in hidden):
            continue
        out.add(u.email)
    return sorted(out)


def _body(t, lead: str) -> str:
    client = t.client.company_name if t.client else "—"
    url = _ticket_url()
    return (f"{lead}\n\n"
            f"Ref:      {t.reference}\n"
            f"Subject:  {t.title}\n"
            f"Business: {client}\n"
            f"Priority: {_v(t.priority)}\n"
            f"Status:   {_v(t.status)}\n"
            + (f"\nOpen it: {url}\n" if url else ""))


def notify_new_ticket(ticket_id: int, exclude_user_id=None):
    if not _enabled():
        return
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t:
            return
        # New tickets go ONLY to the intake inbox (info@); staff monitor that inbox.
        if NEW_TICKET_INBOX:
            mailer.send_email(_to([NEW_TICKET_INBOX]), f"[New] {t.reference} · {t.title}",
                              _body(t, "A new ticket was created."))
    except Exception as e:
        print(f"[notify] new_ticket failed: {e}", flush=True)
    finally:
        db.close()


def notify_assignment(ticket_id: int, assignee_id: int, by_user_id=None):
    if not _enabled() or assignee_id == by_user_id:
        return  # someone assigning a ticket to themselves doesn't need an email
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        a = db.query(User).filter(User.id == assignee_id).first()
        # Assignment notifies ONLY the assigned staff member (not the intake inbox).
        if t and a and a.email and a.email.lower() not in SYS_EMAILS:
            mailer.send_email(_to([a.email]), f"[Assigned] {t.reference} · {t.title}",
                              _body(t, "You've been assigned this ticket."))
    except Exception as e:
        print(f"[notify] assignment failed: {e}", flush=True)
    finally:
        db.close()


def notify_customer_reply(ticket_id: int):
    if not _enabled():
        return
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t:
            return
        recips = []
        if t.assigned_to_id:
            a = db.query(User).filter(User.id == t.assigned_to_id).first()
            if a and a.email:
                recips = [a.email]
        if not recips:  # unassigned — let the whole team know a customer is waiting
            recips = _staff_emails(db)
        if recips:
            mailer.send_email(_to(recips), f"[Reply] {t.reference} · {t.title}",
                              _body(t, "A customer replied on this ticket."))
    except Exception as e:
        print(f"[notify] customer_reply failed: {e}", flush=True)
    finally:
        db.close()


# --- Participant + staff notifications on a public reply -------------------------
# Independent of the staff-broadcast hold (NOTIFY_ENABLED); this transactional
# channel is gated by its own switch, defaulting ON. Tickets whose reference starts
# with "X" (imported Xcitium history) are skipped so testing stays on new tickets.
AXUS_LOGO_URL = "https://axustechnologies.com/wp-content/themes/awi/img/axus-technologies-logo.png"


def _participants_enabled() -> bool:
    return os.getenv("PARTICIPANT_NOTIFY_ENABLED", "1") == "1" and mailer.is_configured()


def _portal_url() -> str:
    url = (os.getenv("PORTAL_URL") or "").strip()
    return url or "https://service.axustechnologies.com/portal"


def _participant_html(recipient_name, lead, block, t, link, note=None) -> str:
    import html as _h
    rn = _h.escape(recipient_name or "there")
    ld = _h.escape(lead or "")
    ref = _h.escape(t.reference or "")
    title = _h.escape(t.title or "")
    msg = _h.escape((block or "").strip()).replace("\n", "<br>")
    block_box = (f'<div style="margin:10px 0 22px;padding:16px 18px;background:#f7f8fa;'
                 f'border-left:4px solid #f26722;border-radius:6px;font-size:15px;'
                 f'line-height:1.6;color:#1f2430;">{msg}</div>') if msg else ""
    note_txt = "You're receiving this because you're a participant on this ticket." if note is None else note
    note_html = (f'<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#9aa1ac;">'
                 f'{_h.escape(note_txt)}</p>') if note_txt else ""
    lk = _h.escape(link or "", quote=True)
    desc = _h.escape((t.description or "").strip()).replace("\n", "<br>")
    desc_block = (f'<p style="margin:12px 0 2px;font-size:11px;color:#9aa1ac;letter-spacing:.5px;">DESCRIPTION</p>'
                  f'<div style="margin:0 0 2px;font-size:13.5px;line-height:1.5;color:#3a4150;">{desc}</div>'
                  ) if desc else ""
    btn = (f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
           f'<td style="border-radius:8px;background:#f26722;">'
           f'<a href="{lk}" style="display:inline-block;padding:11px 24px;font-size:14px;'
           f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">View ticket</a>'
           f'</td></tr></table>') if lk else ""
    return f"""\
<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2430;">
  <tr><td style="padding:24px 32px 8px;"><img src="{AXUS_LOGO_URL}" alt="Axus Technologies" height="32" style="height:32px;display:block;border:0;" /></td></tr>
  <tr><td style="padding:0 32px;">
    <p style="margin:8px 0 2px;font-size:12px;color:#9aa1ac;letter-spacing:.4px;">TICKET {ref}</p>
    <h1 style="margin:2px 0 4px;font-size:20px;color:#1f2430;">{title}</h1>
    {desc_block}
    <p style="margin:16px 0 4px;font-size:15px;line-height:1.55;color:#3a4150;">Hi {rn}, {ld}</p>
    {block_box}
    {btn}
    {note_html}
  </td></tr>
  <tr><td style="padding:24px 32px 28px;"><p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #eef0f3;font-size:12px;color:#9aa1ac;">Axus Technologies &middot; Simplifying IT</p></td></tr>
</table>
</body></html>"""


def _author_display(db, author_id, author_name):
    """Name to show as the sender. Axus staff (admin/technician) are always shown
    as 'Axus Service Team' so customers never see individual staff names."""
    if author_id:
        u = db.query(User).filter(User.id == author_id).first()
        if u and _v(u.role) in ("admin", "technician"):
            return "Axus Service Team"
        if u and u.full_name:
            return u.full_name
    return author_name or "The Axus team"


def _notify_participants(ticket_id, author_id, author_name, subject_word, verb, block,
                         staff_to_inbox=False):
    """Email everyone on a ticket — reporter, added participants, and staff
    (assignee + creator) — except the author. `lead` is the sentence after the
    greeting; `block` is the highlighted content (reply text or change summary).

    When `staff_to_inbox` is True (case closures), the staff side is routed to the
    intake inbox (info@) only — the assigned staff member is NOT emailed individually.
    """
    if not _participants_enabled():
        return
    from app.models.ticket_watcher import TicketWatcher
    from app.models.contact import Contact
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t:
            return
        # Skip imported Xcitium history (references starting with "X").
        if (t.reference or "").strip().upper().startswith("X"):
            return
        lead = f"{_author_display(db, author_id, author_name)} {verb}"
        staff_url, portal_url = _ticket_url(), _portal_url()
        from app.models.client import Client
        hidden = {c.id for c in db.query(Client.id).filter(Client.company_name == "Dummy Business").all()}
        seen, recips = set(), []   # dedup by email; keep (name, email, is_staff, can_view)
        def add(u):
            if not u or not u.email:
                return
            em = u.email.lower()
            if em in seen or em in SYS_EMAILS or u.id == author_id or u.client_id in hidden:
                return
            is_staff = _v(u.role) in ("admin", "technician")
            # On a closure, staff are notified via the intake inbox only — skip
            # every individual staff member (assignee, creator, etc.).
            if staff_to_inbox and is_staff:
                return
            seen.add(em)
            # Only staff, and the client who OPENED the ticket, can open it — so only
            # they get a working "View ticket" link. Participants get email updates only.
            can_view = is_staff or u.id in (t.reporter_user_id, t.created_by_id)
            recips.append((u.full_name, u.email, is_staff, can_view))
        if t.reporter_user_id:
            add(db.query(User).filter(User.id == t.reporter_user_id).first())
        for u in (db.query(User).join(TicketWatcher, TicketWatcher.user_id == User.id)
                  .filter(TicketWatcher.ticket_id == ticket_id).all()):
            add(u)
        if t.assigned_to_id:
            add(db.query(User).filter(User.id == t.assigned_to_id).first())
        if t.created_by_id:
            add(db.query(User).filter(User.id == t.created_by_id).first())
        if t.contact_id:
            c = db.query(Contact).filter(Contact.id == t.contact_id).first()
            if c and c.email and c.email.lower() not in seen and c.email.lower() not in SYS_EMAILS:
                recips.append((getattr(c, "full_name", None), c.email, False, False))
        # Staff side: on a closure, always notify the intake inbox (info@) and never
        # the assignee. Otherwise the assigned tech (added above) gets it, and only an
        # UNASSIGNED ticket falls back to info@.
        if NEW_TICKET_INBOX and NEW_TICKET_INBOX.lower() not in seen and (
                staff_to_inbox or not t.assigned_to_id):
            recips.append((None, NEW_TICKET_INBOX, True, True))
        subject = f"[{t.reference}] {subject_word} · {t.title}"
        for name, email, is_staff, can_view in recips:
            if not is_staff and client_blocked(email):
                continue   # pre-production: client emails suppressed unless allow-listed
            link = ("" if not can_view else (staff_url if is_staff else portal_url))
            text = (f"Ticket {t.reference} — {t.title}\n"
                    + (f"\nDescription:\n{(t.description or '').strip()}\n" if (t.description or '').strip() else "")
                    + f"\nHi {name or 'there'}, {lead}\n\n{(block or '').strip()}\n\n"
                    + (f"View it: {link}\n" if link else "")
                    + "\nYou're receiving this because you're a participant on this ticket.\n")
            html = _participant_html(name, lead, block, t, link)
            # transactional: always to the real participant (never the soft-launch redirect)
            mailer.send_email([email], subject, text, html)
    except Exception as e:
        print(f"[notify] participants ({subject_word}) failed: {e}", flush=True)
    finally:
        db.close()


def notify_participants_reply(ticket_id: int, body: str, author_id=None, author_name=None):
    """Notify everyone on a ticket of a new public reply."""
    _notify_participants(ticket_id, author_id, author_name, "New reply", "added a new reply:", body)


def notify_participants_update(ticket_id: int, summary: str, author_id=None, author_name=None):
    """Notify everyone on a ticket that it was updated (status/priority/etc.)."""
    _notify_participants(ticket_id, author_id, author_name, "Updated", "updated this ticket:", summary)


def notify_participants_closed(ticket_id: int, body: str = "", author_id=None, author_name=None):
    """Single combined 'closed' notification for participants + staff. If a final
    reply accompanied the closure, its text is included in the SAME email (so the
    last update and the close notice are never two separate messages). Staff are
    notified via the intake inbox (info@), never the assignee individually."""
    body = (body or "").strip()
    if body:
        verb = "posted a final reply and closed this case:"
        block = body
    else:
        verb = "closed this case."
        block = ""
    _notify_participants(ticket_id, author_id, author_name, "Case closed", verb, block,
                         staff_to_inbox=True)


TICKET_RECEIVED_MSG = ("Your service ticket has been received, and we are in the process "
                       "of scheduling a technician.")


def notify_ticket_received(ticket_id: int):
    """Email the client who opened a ticket a branded 'received' acknowledgement."""
    if not _participants_enabled():
        return
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t or (t.reference or "").strip().upper().startswith("X"):
            return
        u = db.query(User).filter(User.id == t.reporter_user_id).first() if t.reporter_user_id else None
        if not u or not u.email or _v(u.role) in ("admin", "technician"):
            return  # only client reporters get the acknowledgement
        if client_blocked(u.email):
            return  # pre-production guard
        link = _portal_url()
        subject = f"[{t.reference}] Ticket received · {t.title}"
        text = (f"Hi {u.full_name or 'there'},\n\n{TICKET_RECEIVED_MSG}\n\n"
                f"Ticket {t.reference} — {t.title}\n"
                + (f"\nDescription:\n{(t.description or '').strip()}\n" if (t.description or '').strip() else "")
                + (f"\nView it: {link}\n" if link else "")
                + "\n— Axus Service\n")
        html = _participant_html(u.full_name, TICKET_RECEIVED_MSG, "", t, link, note="")
        mailer.send_email([u.email], subject, text, html)
    except Exception as e:
        print(f"[notify] ticket_received failed: {e}", flush=True)
    finally:
        db.close()

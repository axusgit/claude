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
    domain = os.getenv("PLATFORM_DOMAIN", "")
    return f"https://support.{domain}/staff" if domain else ""


def _v(x):
    return x.value if hasattr(x, "value") else x


def _staff_emails(db, exclude_id=None):
    out = set()
    for u in db.query(User).filter(User.role.in_(STAFF_ROLES), User.is_active == True).all():  # noqa: E712
        if u.id == exclude_id or not u.email or u.email.lower() in SYS_EMAILS:
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
        if t.assigned_to_id:
            if t.assigned_to_id == exclude_user_id:
                return  # creator assigned it to themselves — no need to email
            a = db.query(User).filter(User.id == t.assigned_to_id).first()
            recips = [a.email] if a and a.email else []
        else:
            recips = _staff_emails(db, exclude_id=exclude_user_id)
        if recips:
            mailer.send_email(_to(recips), f"[New] {t.reference} · {t.title}",
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
    domain = os.getenv("PLATFORM_DOMAIN", "")
    return f"https://support.{domain}/portal" if domain else ""


def _reply_html(recipient_name, author_name, t, body, link) -> str:
    import html as _h
    rn = _h.escape(recipient_name or "there")
    an = _h.escape(author_name or "The Axus team")
    ref = _h.escape(t.reference or "")
    title = _h.escape(t.title or "")
    msg = _h.escape((body or "").strip()).replace("\n", "<br>")
    lk = _h.escape(link or "", quote=True)
    btn = (f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
           f'<td style="border-radius:8px;background:#f26722;">'
           f'<a href="{lk}" style="display:inline-block;padding:11px 24px;font-size:14px;'
           f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">View ticket</a>'
           f'</td></tr></table>') if lk else ""
    return f"""\
<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2430;">
    <tr><td style="padding:26px 32px 6px;"><img src="{AXUS_LOGO_URL}" alt="Axus Technologies" height="32" style="height:32px;display:block;border:0;" /></td></tr>
    <tr><td style="padding:6px 32px 0;">
      <p style="margin:10px 0 2px;font-size:12px;color:#9aa1ac;letter-spacing:.4px;">TICKET {ref}</p>
      <h1 style="margin:2px 0 4px;font-size:18px;color:#1f2430;">{title}</h1>
      <p style="margin:14px 0 4px;font-size:14px;line-height:1.55;color:#3a4150;">Hi {rn}, {an} added a new reply:</p>
      <div style="margin:10px 0 20px;padding:14px 16px;background:#f7f8fa;border-left:3px solid #f26722;border-radius:6px;font-size:14px;line-height:1.55;color:#1f2430;">{msg}</div>
      {btn}
      <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#9aa1ac;">You're receiving this because you're a participant on this ticket.</p>
    </td></tr>
    <tr><td style="padding:22px 32px 26px;border-top:1px solid #eef0f3;"><p style="margin:14px 0 0;font-size:12px;color:#9aa1ac;">Axus Technologies &middot; Simplifying IT</p></td></tr>
  </table>
</td></tr></table>
</body></html>"""


def notify_participants_reply(ticket_id: int, body: str, author_id=None, author_name=None):
    """Email everyone on a ticket — reporter, added participants, and staff
    (assignee + creator) — when a public reply is posted, except the author."""
    if not _participants_enabled():
        return
    from app.models.ticket_watcher import TicketWatcher
    from app.models.contact import Contact
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t:
            return
        # Skip imported Xcitium history (references starting with "X") so notification
        # testing only happens on new native tickets.
        if (t.reference or "").strip().upper().startswith("X"):
            return
        staff_url, portal_url = _ticket_url(), _portal_url()
        seen, recips = set(), []   # dedup by email; keep (name, email, is_staff)
        def add(u):
            if not u or not u.email:
                return
            em = u.email.lower()
            if em in seen or em in SYS_EMAILS or u.id == author_id:
                return
            seen.add(em)
            is_staff = _v(u.role) in ("admin", "technician")
            recips.append((u.full_name, u.email, is_staff))
        # participants
        if t.reporter_user_id:
            add(db.query(User).filter(User.id == t.reporter_user_id).first())
        for u in (db.query(User).join(TicketWatcher, TicketWatcher.user_id == User.id)
                  .filter(TicketWatcher.ticket_id == ticket_id).all()):
            add(u)
        # staff on the ticket
        if t.assigned_to_id:
            add(db.query(User).filter(User.id == t.assigned_to_id).first())
        if t.created_by_id:
            add(db.query(User).filter(User.id == t.created_by_id).first())
        # legacy email-intake contact (treated as a client recipient)
        if t.contact_id:
            c = db.query(Contact).filter(Contact.id == t.contact_id).first()
            if c and c.email and c.email.lower() not in seen and c.email.lower() not in SYS_EMAILS:
                recips.append((c.full_name if hasattr(c, "full_name") else None, c.email, False))
        subject = f"[{t.reference}] New reply · {t.title}"
        for name, email, is_staff in recips:
            link = staff_url if is_staff else portal_url
            text = (f"Hi {name or 'there'},\n\n{author_name or 'The Axus team'} added a new reply on "
                    f"ticket {t.reference} ({t.title}):\n\n{(body or '').strip()}\n\n"
                    + (f"View it: {link}\n" if link else "")
                    + "\nYou're receiving this because you're a participant on this ticket.\n")
            html = _reply_html(name, author_name, t, body, link)
            # transactional: always to the real participant (never the staff soft-launch redirect)
            mailer.send_email([email], subject, text, html)
    except Exception as e:
        print(f"[notify] participants_reply failed: {e}", flush=True)
    finally:
        db.close()

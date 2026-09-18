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

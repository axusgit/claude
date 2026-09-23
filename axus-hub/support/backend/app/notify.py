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
    url = (os.getenv("PORTAL_URL") or "").strip()
    if url:
        return url
    domain = os.getenv("PLATFORM_DOMAIN", "")
    return f"https://support.{domain}/portal" if domain else ""


def _participant_html(recipient_name, lead, block, t, link) -> str:
    import html as _h
    rn = _h.escape(recipient_name or "there")
    ld = _h.escape(lead or "")
    ref = _h.escape(t.reference or "")
    title = _h.escape(t.title or "")
    msg = _h.escape((block or "").strip()).replace("\n", "<br>")
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
    <div style="margin:10px 0 22px;padding:16px 18px;background:#f7f8fa;border-left:4px solid #f26722;border-radius:6px;font-size:15px;line-height:1.6;color:#1f2430;">{msg}</div>
    {btn}
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#9aa1ac;">You're receiving this because you're a participant on this ticket.</p>
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


def _notify_participants(ticket_id, author_id, author_name, subject_word, verb, block):
    """Email everyone on a ticket — reporter, added participants, and staff
    (assignee + creator) — except the author. `lead` is the sentence after the
    greeting; `block` is the highlighted content (reply text or change summary)."""
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
        seen, recips = set(), []   # dedup by email; keep (name, email, is_staff)
        def add(u):
            if not u or not u.email:
                return
            em = u.email.lower()
            if em in seen or em in SYS_EMAILS or u.id == author_id or u.client_id in hidden:
                return
            seen.add(em)
            recips.append((u.full_name, u.email, _v(u.role) in ("admin", "technician")))
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
                recips.append((getattr(c, "full_name", None), c.email, False))
        subject = f"[{t.reference}] {subject_word} · {t.title}"
        for name, email, is_staff in recips:
            link = staff_url if is_staff else portal_url
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

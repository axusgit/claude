"""Inbound email -> ticket processing, and outbound reply notifications."""
import re

from app.database import SessionLocal
from app.models.ticket import Ticket, TicketComment, TicketActivity, TicketType
from app.models.client import Client
from app.models.contact import Contact
from app.models.user import User
from app import graph

# Match ticket 'T-', child 'C-', project 'P-', and legacy 'A-' / 'AXUS-' refs in subjects.
REF_RE = re.compile(r"\b(T-\d+|C-\d+|P-\d+|A-\d+|AXUS-\d+)\b", re.I)
UNMATCHED_COMPANY = "Unmatched Senders"
SYS_EMAIL = "email-intake@axustechnologies.com"


def _system_user(db):
    u = db.query(User).filter(User.email == SYS_EMAIL).first()
    if not u:
        u = User(email=SYS_EMAIL, full_name="Email Intake", hashed_password="", role="technician")
        db.add(u); db.commit(); db.refresh(u)
    return u


def _unmatched_client(db):
    c = db.query(Client).filter(Client.company_name == UNMATCHED_COMPANY).first()
    if not c:
        c = Client(company_name=UNMATCHED_COMPANY, contact_name="—", email="noreply@axustechnologies.com")
        db.add(c); db.commit(); db.refresh(c)
    return c


def _resolve_sender(db, email, name):
    """Map an inbound sender to (client_id, contact_id), auto-provisioning a
    contact under 'Unmatched Senders' when unknown."""
    if email:
        contact = db.query(Contact).filter(Contact.email == email).first()
        if contact:
            return contact.client_id, contact.id
        client = db.query(Client).filter(Client.email == email).first()
        if client:
            return client.id, None
    uc = _unmatched_client(db)
    contact = Contact(client_id=uc.id, full_name=name or email or "Unknown", email=email or None)
    db.add(contact); db.commit(); db.refresh(contact)
    return uc.id, contact.id


def _find_ticket(db, subject, conversation_id):
    m = REF_RE.search(subject or "")
    if m:
        t = db.query(Ticket).filter(Ticket.reference == m.group(1).upper()).first()
        if t:
            return t
    if conversation_id:
        return db.query(Ticket).filter(Ticket.email_conversation_id == conversation_id).first()
    return None


def _process_one(db, msg):
    sender = (msg.get("from") or {}).get("emailAddress", {}) or {}
    email = (sender.get("address") or "").lower()
    name = sender.get("name") or email
    subject = msg.get("subject") or "(no subject)"
    body = ((msg.get("body") or {}).get("content")) or msg.get("bodyPreview") or ""
    conv = msg.get("conversationId")
    sys_user = _system_user(db)

    ticket = _find_ticket(db, subject, conv)
    if ticket:
        db.add(TicketComment(
            ticket_id=ticket.id, author_id=sys_user.id, is_internal=False,
            body=f"✉ {name} <{email}> replied via email:\n\n{body}",
        ))
        db.add(TicketActivity(ticket_id=ticket.id, user_id=sys_user.id,
                              action="comment_added", detail="Reply received by email"))
        db.commit()
        return "reply"

    client_id, contact_id = _resolve_sender(db, email, name)
    from app.models.board import default_board_id
    ticket = Ticket(
        title=subject[:200],
        description=f"From: {name} <{email}>\n\n{body}",
        client_id=client_id, contact_id=contact_id, created_by_id=sys_user.id,
        board_id=default_board_id(db),
        email_conversation_id=conv, ticket_type=TicketType.standard,
    )
    db.add(ticket)
    from app.routers.tickets import generate_ticket_reference
    ticket.reference = generate_ticket_reference(db)
    db.flush()
    db.add(TicketActivity(ticket_id=ticket.id, user_id=sys_user.id,
                          action="created", detail=f"Created from email: {subject}"))
    db.commit()
    return "new"


def process_inbox():
    """Poll the shared mailbox once; create/append tickets. Marks mail read only
    on success so failures are retried next poll."""
    if not graph.is_configured():
        return {"configured": False, "processed": 0}
    msgs = graph.fetch_unread()
    db = SessionLocal()
    results = {"new": 0, "reply": 0, "errors": 0}
    try:
        for m in msgs:
            try:
                results[_process_one(db, m)] += 1
                graph.mark_read(m["id"])
            except Exception:
                db.rollback()
                results["errors"] += 1
    finally:
        db.close()
    return {"configured": True, "fetched": len(msgs), **results}


def notify_contact_reply(ticket_id: int, body: str, author_id: int | None = None):
    """Email everyone on the ticket a staff public reply.

    Recipients: the reporter who opened it, every additional user, and any legacy
    email-intake contact. Best effort, threaded by reference in the subject.
    """
    if not graph.is_configured():
        return
    from app.models.ticket_watcher import TicketWatcher
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t:
            return
        recipients = set()
        # reporter who opened the ticket
        if t.reporter_user_id:
            r = db.query(User).filter(User.id == t.reporter_user_id).first()
            if r and r.email:
                recipients.add(r.email)
        # additional users on the ticket
        watcher_users = (
            db.query(User)
            .join(TicketWatcher, TicketWatcher.user_id == User.id)
            .filter(TicketWatcher.ticket_id == ticket_id)
            .all()
        )
        for u in watcher_users:
            if u.email:
                recipients.add(u.email)
        # legacy email-intake contact
        if t.contact_id:
            c = db.query(Contact).filter(Contact.id == t.contact_id).first()
            if c and c.email:
                recipients.add(c.email)
        if not recipients:
            return
        logo = None
        if author_id:
            author = db.query(User).filter(User.id == author_id).first()
            logo = author.signature_logo if author else None
        graph.send_mail(sorted(recipients), f"[{t.reference}] {t.title}", body, logo_data_url=logo)
    except Exception:
        pass
    finally:
        db.close()

"""Inbound email -> ticket processing, and outbound reply notifications."""
import re

from app.database import SessionLocal
from app.models.ticket import Ticket, TicketComment, TicketActivity, TicketType
from app.models.client import Client
from app.models.contact import Contact
from app.models.user import User
from app import graph

REF_RE = re.compile(r"AXUS-(\d+)", re.I)
REFERENCE_BASE = 1000  # keep in sync with routers/tickets.py
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
        t = db.query(Ticket).filter(Ticket.reference == f"AXUS-{m.group(1)}").first()
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
    ticket = Ticket(
        title=subject[:200],
        description=f"From: {name} <{email}>\n\n{body}",
        client_id=client_id, contact_id=contact_id, created_by_id=sys_user.id,
        email_conversation_id=conv, ticket_type=TicketType.standard,
    )
    db.add(ticket)
    db.flush()
    ticket.reference = f"AXUS-{REFERENCE_BASE + ticket.id}"
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


def notify_contact_reply(ticket_id: int, body: str):
    """Email the ticket's contact a staff public reply (best effort, threaded by ref)."""
    if not graph.is_configured():
        return
    db = SessionLocal()
    try:
        t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not t or not t.contact_id:
            return
        c = db.query(Contact).filter(Contact.id == t.contact_id).first()
        if not c or not c.email:
            return
        graph.send_mail(c.email, f"[{t.reference}] {t.title}", body)
    except Exception:
        pass
    finally:
        db.close()

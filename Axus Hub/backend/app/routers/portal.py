"""Client-facing portal API.

Every endpoint is scoped to the logged-in client user's own company (client_id)
and only ever exposes public conversation (internal staff notes are never returned).
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from uuid import uuid4
import os
from pydantic import BaseModel

from app.database import get_db
from app.models.ticket import Ticket, TicketComment, TicketType
from app.models.attachment import Attachment
from app.models.user import User, UserRole
from app.auth import get_current_user
from app.routers.tickets import (
    REFERENCE_BASE, UPLOAD_DIR, MAX_ATTACHMENT_BYTES, _log_activity,
    TicketOut, CommentOut, AttachmentOut,
)

router = APIRouter(prefix="/api/portal", tags=["portal"])


def require_client_user(current_user: User = Depends(get_current_user)) -> User:
    """Allow only client-portal users (role=client with an associated company)."""
    if current_user.role != UserRole.client or current_user.client_id is None:
        raise HTTPException(status_code=403, detail="Client portal access only")
    return current_user


def _owned_ticket(db: Session, ticket_id: int, user: User) -> Ticket:
    """Fetch a ticket only if it belongs to the user's company, else 404."""
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.client_id == user.client_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


class PortalTicketIn(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    priority: str = "medium"


class PortalReplyIn(BaseModel):
    body: str


@router.get("/me")
def whoami(user: User = Depends(require_client_user), db: Session = Depends(get_db)):
    from app.models.client import Client
    client = db.query(Client).filter(Client.id == user.client_id).first()
    return {
        "full_name": user.full_name,
        "email": user.email,
        "company": client.company_name if client else None,
    }


@router.get("/tickets", response_model=List[TicketOut])
def my_tickets(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_client_user),
):
    q = db.query(Ticket).filter(Ticket.client_id == user.client_id)
    if status:
        q = q.filter(Ticket.status == status)
    return q.order_by(Ticket.created_at.desc()).all()


@router.post("/tickets", response_model=TicketOut)
def submit_ticket(
    data: PortalTicketIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_client_user),
):
    ticket = Ticket(
        title=data.title,
        description=data.description,
        category=data.category,
        priority=data.priority,
        client_id=user.client_id,        # forced to the user's own company
        created_by_id=user.id,
        ticket_type=TicketType.standard,
    )
    db.add(ticket)
    db.flush()
    ticket.reference = f"AXUS-{REFERENCE_BASE + ticket.id}"
    _log_activity(db, ticket.id, user.id, "created", f"Submitted via portal: {ticket.title}")
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def view_ticket(ticket_id: int, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    return _owned_ticket(db, ticket_id, user)


@router.get("/tickets/{ticket_id}/comments", response_model=List[CommentOut])
def ticket_comments(ticket_id: int, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    _owned_ticket(db, ticket_id, user)
    # Clients only ever see public replies, never internal staff notes.
    return (
        db.query(TicketComment)
        .filter(TicketComment.ticket_id == ticket_id, TicketComment.is_internal == False)  # noqa: E712
        .order_by(TicketComment.created_at)
        .all()
    )


@router.post("/tickets/{ticket_id}/comments", response_model=CommentOut)
def reply(ticket_id: int, data: PortalReplyIn, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    _owned_ticket(db, ticket_id, user)
    comment = TicketComment(
        ticket_id=ticket_id,
        author_id=user.id,
        body=data.body,
        is_internal=False,   # portal replies are always public
    )
    db.add(comment)
    _log_activity(db, ticket_id, user.id, "comment_added", "Client replied via portal")
    db.commit()
    db.refresh(comment)
    return comment


@router.get("/tickets/{ticket_id}/attachments", response_model=List[AttachmentOut])
def list_attachments(ticket_id: int, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    _owned_ticket(db, ticket_id, user)
    return (
        db.query(Attachment)
        .filter(Attachment.ticket_id == ticket_id)
        .order_by(Attachment.created_at)
        .all()
    )


@router.post("/tickets/{ticket_id}/attachments", response_model=AttachmentOut)
def upload_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_client_user),
):
    _owned_ticket(db, ticket_id, user)
    content = file.file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit")

    original = os.path.basename(file.filename or "file")
    stored_name = f"{uuid4().hex}{os.path.splitext(original)[1]}"
    with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
        f.write(content)

    attachment = Attachment(
        ticket_id=ticket_id,
        uploaded_by_id=user.id,
        filename=original,
        content_type=file.content_type,
        size=len(content),
        stored_name=stored_name,
    )
    db.add(attachment)
    _log_activity(db, ticket_id, user.id, "attachment_added", f"Client attached {original}")
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}")
def download_attachment(ticket_id: int, attachment_id: int, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    _owned_ticket(db, ticket_id, user)
    attachment = (
        db.query(Attachment)
        .filter(Attachment.id == attachment_id, Attachment.ticket_id == ticket_id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = os.path.join(UPLOAD_DIR, attachment.stored_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=410, detail="File is no longer available")
    return FileResponse(path, filename=attachment.filename, media_type=attachment.content_type or "application/octet-stream")

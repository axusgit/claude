"""Client-facing portal API.

Every endpoint is scoped to the logged-in client user's own company (client_id)
and only ever exposes public conversation (internal staff notes are never returned).
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import os
import secrets
import hashlib
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models.ticket import Ticket, TicketComment, TicketType
from app.models.attachment import Attachment
from app.models.user import User, UserRole
from app.models.magic_token import PortalMagicToken
from app.auth import _user_from_jwt, create_access_token
from app import mailer
from app.routers.tickets import (
    generate_ticket_reference, UPLOAD_DIR, MAX_ATTACHMENT_BYTES, _log_activity,
    TicketOut, CommentOut, AttachmentOut,
)

router = APIRouter(prefix="/api/portal", tags=["portal"])


def require_client_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Allow only client-portal users. Portal auth is ALWAYS the local JWT (the
    passwordless magic-link session) — customers never pass through the staff
    Authentik SSO, so this is independent of AUTH_MODE."""
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth[:7].lower() == "bearer " else None
    user = _user_from_jwt(token, db)   # 401 if missing / invalid / expired
    if user.role != UserRole.client or user.client_id is None:
        raise HTTPException(status_code=403, detail="Client portal access only")
    return user


# ---------- passwordless magic-link sign-in ----------
MAGIC_TTL_MIN = int(os.getenv("PORTAL_MAGIC_TTL_MIN", "15"))
PORTAL_SESSION_MIN = int(os.getenv("PORTAL_SESSION_MIN", str(30 * 24 * 60)))  # 30 days
PORTAL_URL = os.getenv("PORTAL_URL") or f"https://support.{os.getenv('PLATFORM_DOMAIN', '')}/portal"
_NEUTRAL = {"ok": True, "message": "If that email is on file, a sign-in link is on its way."}


class MagicRequestIn(BaseModel):
    email: EmailStr


class MagicVerifyIn(BaseModel):
    token: str


def _hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


@router.post("/auth/request")
def magic_request(data: MagicRequestIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Email a one-time sign-in link — invite-only (only existing client users get one)
    and non-enumerating (always the same neutral response)."""
    email = (data.email or "").strip().lower()
    user = (db.query(User)
            .filter(func.lower(User.email) == email, User.is_active == True).first())  # noqa: E712
    if not user or user.role != UserRole.client or user.client_id is None:
        return _NEUTRAL
    raw = secrets.token_urlsafe(32)
    db.add(PortalMagicToken(
        user_id=user.id, token_hash=_hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=MAGIC_TTL_MIN),
    ))
    db.commit()
    link = f"{PORTAL_URL}?login={raw}"
    body = (f"Hi {user.full_name or 'there'},\n\n"
            f"Use this link to sign in to the Axus support portal:\n\n{link}\n\n"
            f"It works once and expires in {MAGIC_TTL_MIN} minutes. If you didn't request "
            f"it, you can safely ignore this email.\n\n— Axus Technologies\n")
    background.add_task(mailer.send_email, user.email, "Your Axus support portal sign-in link", body)
    return _NEUTRAL


@router.post("/auth/verify")
def magic_verify(data: MagicVerifyIn, db: Session = Depends(get_db)):
    """Redeem a magic link (single-use) and mint a 30-day portal session token."""
    rec = (db.query(PortalMagicToken)
           .filter(PortalMagicToken.token_hash == _hash_token(data.token)).first())
    now = datetime.now(timezone.utc)
    if not rec or rec.used_at is not None or rec.expires_at < now:
        raise HTTPException(status_code=400,
                            detail="This sign-in link is invalid or has expired. Please request a new one.")
    user = db.query(User).filter(User.id == rec.user_id, User.is_active == True).first()
    if not user or user.role != UserRole.client:
        raise HTTPException(status_code=400, detail="This sign-in link is no longer valid.")
    rec.used_at = now
    db.commit()
    token = create_access_token({"sub": user.id}, expires_minutes=PORTAL_SESSION_MIN)
    return {"access_token": token, "token_type": "bearer"}


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
    role = user.role.value if hasattr(user.role, "value") else user.role
    return {
        "id": user.id,
        "role": role,
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
        origin="client_portal",
    )
    from app.models.board import default_board_id
    ticket.board_id = default_board_id(db)
    db.add(ticket)
    ticket.reference = generate_ticket_reference(db)
    db.flush()
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
def reply(ticket_id: int, data: PortalReplyIn, background: BackgroundTasks,
          db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    from app import notify
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
    background.add_task(notify.notify_customer_reply, ticket_id)  # tell staff a customer replied
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

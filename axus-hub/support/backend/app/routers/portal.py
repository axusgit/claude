"""Client-facing portal API.

Every endpoint is scoped to the logged-in client user's own company (client_id)
and only ever exposes public conversation (internal staff notes are never returned).
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import os
import secrets
import hashlib
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models.ticket import Ticket, TicketComment, TicketType, TicketStatus, TicketPriority
from app.models.attachment import Attachment
from app.models.user import User, UserRole
from app.models.magic_token import PortalMagicToken
from app.auth import _user_from_jwt, create_access_token
from app import mailer
from app.routers.tickets import (
    generate_ticket_reference, UPLOAD_DIR, MAX_ATTACHMENT_BYTES, _log_activity,
    TicketOut, CommentOut, AttachmentOut, MAX_ADDITIONAL_USERS,
)
from app.models.ticket_watcher import TicketWatcher

router = APIRouter(prefix="/api/portal", tags=["portal"])

# File types customers may attach to a ticket. Enforced server-side (the client
# `accept=` attribute is only a UI hint and can be bypassed).
ALLOWED_ATTACHMENT_EXTS = {
    ".doc", ".pdf", ".jpg", ".jpeg", ".gif", ".png", ".xls", ".docx", ".xlsx",
    ".txt", ".pcapng", ".eml", ".pcap", ".wav", ".csv", ".mp4", ".mp3", ".heic",
}


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
PORTAL_URL = os.getenv("PORTAL_URL") or "https://service.axustechnologies.com/portal"
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
    from app import notify
    if notify.client_blocked(user.email):   # pre-production: only allow-listed test clients
        return _NEUTRAL
    raw = secrets.token_urlsafe(32)
    db.add(PortalMagicToken(
        user_id=user.id, token_hash=_hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=MAGIC_TTL_MIN),
    ))
    db.commit()
    link = f"{PORTAL_URL}?login={raw}"
    name = user.full_name or "there"
    body = (f"Hi {name},\n\n"
            f"Use this link to sign in to the Axus support portal:\n\n{link}\n\n"
            f"It works once and expires in {MAGIC_TTL_MIN} minutes. If you didn't request "
            f"it, you can safely ignore this email.\n\n— Axus Technologies\n")
    html = _magic_link_html(name, link)
    background.add_task(mailer.send_email, user.email,
                        "Your Axus support portal sign-in link", body, html)
    return _NEUTRAL


AXUS_LOGO_URL = "https://axustechnologies.com/wp-content/themes/awi/img/axus-technologies-logo.png"


def _magic_link_html(name: str, link: str) -> str:
    """Branded HTML for the passwordless sign-in email (Axus logo + button)."""
    import html as _h
    n = _h.escape(name)
    l = _h.escape(link, quote=True)
    return f"""\
<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2430;">
    <tr><td style="padding:28px 32px 8px;">
      <img src="{AXUS_LOGO_URL}" alt="Axus Technologies" height="34" style="height:34px;display:block;border:0;" />
    </td></tr>
    <tr><td style="padding:8px 32px 0;">
      <h1 style="margin:12px 0 4px;font-size:19px;color:#1f2430;">Sign in to the Axus support portal</h1>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.55;color:#3a4150;">Hi {n},</p>
      <p style="margin:10px 0 22px;font-size:14px;line-height:1.55;color:#3a4150;">Use the button below to sign in. It works once and expires in {MAGIC_TTL_MIN} minutes.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#f26722;">
        <a href="{l}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign in to the portal</a>
      </td></tr></table>
      <p style="margin:22px 0 0;font-size:12.5px;line-height:1.5;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:6px 0 0;font-size:12.5px;line-height:1.5;word-break:break-all;"><a href="{l}" style="color:#f26722;">{l}</a></p>
      <p style="margin:22px 0 0;font-size:12.5px;line-height:1.5;color:#6b7280;">If you didn't request this, you can safely ignore this email.</p>
    </td></tr>
    <tr><td style="padding:24px 32px 28px;border-top:1px solid #eef0f3;margin-top:20px;">
      <p style="margin:16px 0 0;font-size:12px;color:#9aa1ac;">Axus Technologies &middot; Simplifying IT</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>"""


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


def _can_see(db: Session, ticket: Ticket, user: User) -> bool:
    """Per-USER visibility: a client sees a ticket in the portal ONLY if they
    opened it (reporter/creator). Belonging to the same company is NOT enough,
    and being added as a participant is NOT enough either — participants receive
    updates by email only, they do not get portal access to the ticket."""
    return ticket.reporter_user_id == user.id or ticket.created_by_id == user.id


def _owned_ticket(db: Session, ticket_id: int, user: User) -> Ticket:
    """Fetch a ticket only if it's visible to this user (see `_can_see`), else 404."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket or not _can_see(db, ticket, user):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


class PortalTicketIn(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    priority: str = "medium"


class PortalReplyIn(BaseModel):
    body: Optional[str] = None
    close: bool = False   # client closes the case (with the inline legal confirmation)


class PortalPriorityIn(BaseModel):
    priority: str


# Clients may ESCALATE (raise) a ticket's priority, never lower it.
_PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _prio_str(p) -> str:
    return (p.value if hasattr(p, "value") else str(p or "medium")).lower()


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
    # Per-user scoping: only tickets this user opened (reporter/creator).
    # Participants are notified by email but do not see tickets in the portal.
    q = db.query(Ticket).filter(or_(
        Ticket.reporter_user_id == user.id,
        Ticket.created_by_id == user.id,
    ))
    if status:
        q = q.filter(Ticket.status == status)
    return q.order_by(Ticket.created_at.desc()).all()


@router.post("/tickets", response_model=TicketOut)
def submit_ticket(
    data: PortalTicketIn,
    background: BackgroundTasks,
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
        reporter_user_id=user.id,         # the client who opened it (for scoping + participants)
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
    from app import notify
    background.add_task(notify.notify_new_ticket, ticket.id)       # staff intake (info@)
    background.add_task(notify.notify_ticket_received, ticket.id)  # client acknowledgement
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


@router.post("/tickets/{ticket_id}/comments")
def reply(ticket_id: int, data: PortalReplyIn, background: BackgroundTasks,
          db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    from app import notify
    t = _owned_ticket(db, ticket_id, user)
    # Closed cases are read-only for clients — no replies, no re-close.
    if t.status == TicketStatus.closed:
        raise HTTPException(status_code=409, detail="This case is closed. Please open a new ticket for further help.")
    body = (data.body or "").strip()
    # Clients must always add a note in the Conversation field — both to post a
    # reply and to close a case.
    if not body:
        detail = ("Please add a note in the Conversation field before closing the case."
                  if data.close else "Please enter your message before posting.")
        raise HTTPException(status_code=400, detail=detail)
    comment = None
    if body:
        comment = TicketComment(ticket_id=ticket_id, author_id=user.id, body=body, is_internal=False)
        db.add(comment)
        _log_activity(db, ticket_id, user.id, "comment_added", "Client replied via portal")
    closed = False
    if data.close and t.status != TicketStatus.closed:
        t.status = TicketStatus.closed
        t.closed_at = datetime.now(timezone.utc)
        _log_activity(db, ticket_id, user.id, "status_changed", "Client closed the case via portal")
        closed = True
    db.commit()
    if comment:
        db.refresh(comment)
    if closed:
        # One combined email: the final reply (if any) + the close notice, staff -> info@.
        background.add_task(notify.notify_participants_closed, ticket_id, body, user.id, user.full_name)
    elif comment:
        background.add_task(notify.notify_customer_reply, ticket_id)  # staff broadcast (held by NOTIFY_ENABLED)
        background.add_task(notify.notify_participants_reply, ticket_id, body, user.id, user.full_name)
    return {"ok": True, "closed": closed}


@router.patch("/tickets/{ticket_id}/priority")
def raise_priority(ticket_id: int, data: PortalPriorityIn, background: BackgroundTasks,
                   db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    """Client-side escalation: raise a ticket's priority only (never lower it)."""
    from app import notify
    t = _owned_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise HTTPException(status_code=409, detail="This case is closed.")
    new = (data.priority or "").strip().lower()
    if new not in _PRIORITY_RANK:
        raise HTTPException(status_code=400, detail="Invalid priority.")
    cur = _prio_str(t.priority)
    if _PRIORITY_RANK[new] <= _PRIORITY_RANK.get(cur, 1):
        raise HTTPException(status_code=400, detail="You can only raise the priority, not lower it.")
    t.priority = TicketPriority(new)
    _log_activity(db, ticket_id, user.id, "priority_changed",
                  f"Client raised priority from {cur} to {new}")
    db.commit()
    # Notify staff + participants of the escalation (assignee, else info@).
    background.add_task(notify.notify_participants_update, ticket_id,
                        f"Priority raised to {new.capitalize()}.", user.id, user.full_name)
    return {"ok": True, "priority": new}


# ----- Participants (people on a ticket) — clients may add colleagues from their org -----

class ParticipantIn(BaseModel):
    user_id: Optional[int] = None   # an existing member of the caller's business
    email: Optional[str] = None     # or any other person's email
    name: Optional[str] = None      # optional display name for a new email participant


def _participant(u: User, is_reporter: bool) -> dict:
    return {"id": u.id, "full_name": u.full_name, "email": u.email, "is_reporter": is_reporter}


@router.get("/tickets/{ticket_id}/participants")
def list_participants(ticket_id: int, db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    t = _owned_ticket(db, ticket_id, user)
    out = []
    if t.reporter_user_id:
        r = db.query(User).filter(User.id == t.reporter_user_id).first()
        if r:
            out.append(_participant(r, True))
    for u in (db.query(User).join(TicketWatcher, TicketWatcher.user_id == User.id)
              .filter(TicketWatcher.ticket_id == ticket_id).order_by(User.full_name).all()):
        out.append(_participant(u, False))
    return out


@router.get("/org-users")
def org_users(db: Session = Depends(get_db), user: User = Depends(require_client_user)):
    """People from the caller's own company they can add as participants."""
    rows = (db.query(User)
            .filter(User.client_id == user.client_id, User.role == UserRole.client,
                    User.is_active == True, User.id != user.id)  # noqa: E712
            .order_by(User.full_name).all())
    return [{"id": u.id, "full_name": u.full_name, "email": u.email} for u in rows]


@router.post("/tickets/{ticket_id}/participants")
def add_participant(ticket_id: int, data: ParticipantIn, db: Session = Depends(get_db),
                    user: User = Depends(require_client_user)):
    t = _owned_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise HTTPException(status_code=409, detail="This case is closed.")
    target = None
    if data.user_id:
        # an existing member of the caller's own business
        target = db.query(User).filter(User.id == data.user_id,
                                       User.client_id == user.client_id).first()
        if not target:
            raise HTTPException(status_code=400, detail="That person isn't in your organization.")
    elif data.email:
        # any other person, by email — reuse an existing account or create a light one
        em = (data.email or "").strip().lower()
        if "@" not in em or "." not in em.rsplit("@", 1)[-1]:
            raise HTTPException(status_code=400, detail="Enter a valid email address.")
        target = db.query(User).filter(User.email.ilike(em)).first()
        if not target:
            target = User(email=em, full_name=(data.name or "").strip() or em.split("@")[0],
                          hashed_password="", role=UserRole.client, client_id=user.client_id)
            db.add(target)
            db.flush()
    else:
        raise HTTPException(status_code=400, detail="Choose a colleague or enter an email address.")
    if target.id == t.reporter_user_id:
        raise HTTPException(status_code=400, detail="That person opened the ticket and is already on it.")
    if db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket_id,
                                      TicketWatcher.user_id == target.id).first():
        raise HTTPException(status_code=400, detail="That person is already a participant.")
    if db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket_id).count() >= MAX_ADDITIONAL_USERS:
        raise HTTPException(status_code=400, detail=f"A ticket can have at most {MAX_ADDITIONAL_USERS} added participants.")
    db.add(TicketWatcher(ticket_id=ticket_id, user_id=target.id))
    _log_activity(db, ticket_id, user.id, "participant_added", f"{user.full_name} added {target.full_name} to the ticket")
    db.commit()
    return _participant(target, False)


@router.delete("/tickets/{ticket_id}/participants/{user_id}")
def remove_participant(ticket_id: int, user_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_client_user)):
    t = _owned_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise HTTPException(status_code=409, detail="This case is closed.")
    if user_id == t.reporter_user_id:
        raise HTTPException(status_code=400, detail="The person who opened the ticket can't be removed.")
    w = db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket_id,
                                       TicketWatcher.user_id == user_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Participant not found")
    db.delete(w)
    _log_activity(db, ticket_id, user.id, "participant_removed", f"{user.full_name} removed a participant")
    db.commit()
    return {"status": "removed", "user_id": user_id}


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
    t = _owned_ticket(db, ticket_id, user)
    if t.status == TicketStatus.closed:
        raise HTTPException(status_code=409, detail="This case is closed.")
    original = os.path.basename(file.filename or "file")
    ext = os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_ATTACHMENT_EXTS:
        allowed = ", ".join(sorted(e[1:] for e in ALLOWED_ATTACHMENT_EXTS))
        raise HTTPException(status_code=400,
                            detail=f"File type not allowed. Accepted formats: {allowed}")
    content = file.file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit")

    stored_name = f"{uuid4().hex}{ext}"
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

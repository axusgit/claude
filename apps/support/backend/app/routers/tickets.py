from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from uuid import uuid4
import os
import random
from app.database import get_db
from app.models.ticket import Ticket, TimeEntry, TicketComment, TicketActivity, TicketStatus, TicketType
from app.models.ticket_watcher import TicketWatcher
from app.models.attachment import Attachment
from app.auth import get_current_user
from app.models.user import User
from pydantic import BaseModel

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

STANDARD_HOUR_LIMIT = 8.0


def generate_ticket_reference(db: Session) -> str:
    """A unique ticket reference: 'A-' + a 6-digit random number, e.g. A-481923."""
    for _ in range(50):
        ref = f"A-{random.randint(100000, 999999)}"
        if not db.query(Ticket).filter(Ticket.reference == ref).first():
            return ref
    raise HTTPException(status_code=500, detail="Could not allocate a ticket reference")

# Where uploaded files are stored on disk, and the per-file size cap.
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
MAX_ATTACHMENT_BYTES = int(os.getenv("MAX_ATTACHMENT_MB", "25")) * 1024 * 1024
os.makedirs(UPLOAD_DIR, exist_ok=True)


class TicketIn(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    priority: str = "medium"
    client_id: int
    board_id: Optional[int] = None
    reporter_user_id: Optional[int] = None  # business user who reported it
    assigned_to_id: Optional[int] = None


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    client_id: Optional[int] = None
    board_id: Optional[int] = None
    reporter_user_id: Optional[int] = None
    assigned_to_id: Optional[int] = None


class TimeEntryIn(BaseModel):
    hours: float
    notes: Optional[str] = None


class TimeEntryOut(BaseModel):
    id: int
    hours: float
    notes: Optional[str]
    logged_at: datetime
    user_id: int

    class Config:
        from_attributes = True


class CommentIn(BaseModel):
    body: str
    is_internal: bool = False  # internal note (staff-only) vs public reply to the client


class CommentOut(BaseModel):
    id: int
    ticket_id: int
    author_id: int
    body: str
    is_internal: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ActivityOut(BaseModel):
    id: int
    ticket_id: int
    user_id: Optional[int]
    action: str
    detail: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AttachmentOut(BaseModel):
    id: int
    ticket_id: int
    comment_id: Optional[int]
    uploaded_by_id: int
    filename: str
    content_type: Optional[str]
    size: int
    created_at: datetime

    class Config:
        from_attributes = True


def _log_activity(db: Session, ticket_id: int, user_id: Optional[int], action: str, detail: Optional[str] = None):
    """Record a ticket lifecycle event. Caller is responsible for committing."""
    db.add(TicketActivity(ticket_id=ticket_id, user_id=user_id, action=action, detail=detail))


def _fmt(value):
    """Render a value for an activity message, unwrapping enums to their value."""
    return value.value if hasattr(value, "value") else value


# Fields whose changes are recorded in the ticket activity log, with display labels.
AUDITED_FIELDS = {
    "status": "Status",
    "priority": "Priority",
    "assigned_to_id": "Assignee",
    "category": "Category",
}


class TicketOut(BaseModel):
    id: int
    reference: Optional[str]
    title: str
    description: Optional[str]
    category: Optional[str]
    status: str
    priority: str
    ticket_type: str
    client_id: int
    board_id: Optional[int]
    contact_id: Optional[int]
    reporter_user_id: Optional[int]
    assigned_to_id: Optional[int]
    created_by_id: int
    total_hours: float
    invoiced: bool
    created_at: datetime
    updated_at: Optional[datetime]
    closed_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[TicketOut])
def list_tickets(
    status: Optional[str] = None,
    client_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(Ticket)
    if status:
        q = q.filter(Ticket.status == status)
    if client_id:
        q = q.filter(Ticket.client_id == client_id)
    return q.order_by(Ticket.created_at.desc()).all()


@router.post("/", response_model=TicketOut)
def create_ticket(data: TicketIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.models.board import default_board_id
    ticket = Ticket(
        **data.model_dump(),
        created_by_id=current_user.id,
        ticket_type=TicketType.standard,
    )
    if ticket.board_id is None:
        ticket.board_id = default_board_id(db)
    db.add(ticket)
    ticket.reference = generate_ticket_reference(db)
    db.flush()  # assign ticket.id for the activity log
    _log_activity(db, ticket.id, current_user.id, "created", f"Ticket created: {ticket.title}")
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


@router.put("/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, data: TicketUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    changes = data.model_dump(exclude_none=True)
    # Snapshot audited fields before applying, so we can log what actually changed.
    old = {field: getattr(ticket, field) for field in AUDITED_FIELDS if field in changes}

    for key, value in changes.items():
        setattr(ticket, key, value)

    # Auto-close timestamp
    if data.status == TicketStatus.closed and not ticket.closed_at:
        ticket.closed_at = datetime.utcnow()

    for field, label in AUDITED_FIELDS.items():
        if field in changes and changes[field] != old[field]:
            _log_activity(
                db, ticket.id, current_user.id, f"{field}_changed",
                f"{label} changed from {_fmt(old[field])} to {_fmt(changes[field])}",
            )

    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/{ticket_id}/time", response_model=TimeEntryOut)
def log_time(
    ticket_id: int,
    data: TimeEntryIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    entry = TimeEntry(ticket_id=ticket_id, user_id=current_user.id, **data.model_dump())
    db.add(entry)

    # Update total hours and auto-promote to SOW if over 8 hours
    ticket.total_hours = (ticket.total_hours or 0) + data.hours
    _log_activity(db, ticket_id, current_user.id, "time_logged", f"Logged {data.hours}h")
    if ticket.total_hours >= STANDARD_HOUR_LIMIT and ticket.ticket_type == TicketType.standard:
        ticket.ticket_type = TicketType.sow
        _log_activity(db, ticket_id, None, "type_changed", "Promoted to SOW (over 8 hours)")

    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{ticket_id}/time", response_model=List[TimeEntryOut])
def get_time_entries(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TimeEntry).filter(TimeEntry.ticket_id == ticket_id).all()


@router.post("/{ticket_id}/comments", response_model=CommentOut)
def add_comment(
    ticket_id: int,
    data: CommentIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    comment = TicketComment(
        ticket_id=ticket_id,
        author_id=current_user.id,
        body=data.body,
        is_internal=data.is_internal,
    )
    db.add(comment)
    _log_activity(
        db, ticket_id, current_user.id, "comment_added",
        "Internal note added" if data.is_internal else "Public reply added",
    )
    db.commit()
    db.refresh(comment)
    # Public staff replies are emailed to the ticket's contact (best effort).
    if not data.is_internal:
        from app import email_intake
        background.add_task(email_intake.notify_contact_reply, ticket_id, data.body, current_user.id)
    return comment


@router.get("/{ticket_id}/comments", response_model=List[CommentOut])
def get_comments(
    ticket_id: int,
    public_only: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    q = db.query(TicketComment).filter(TicketComment.ticket_id == ticket_id)
    # public_only hides internal staff notes (e.g. for the future client portal).
    if public_only:
        q = q.filter(TicketComment.is_internal == False)  # noqa: E712
    return q.order_by(TicketComment.created_at).all()


class CommentEditIn(BaseModel):
    body: str


def _editable_comment(db, ticket_id, comment_id, user):
    c = db.query(TicketComment).filter(
        TicketComment.id == comment_id, TicketComment.ticket_id == ticket_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Authors may edit/delete their own notes; admins may manage any.
    if c.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only edit your own notes")
    return c


@router.put("/{ticket_id}/comments/{comment_id}", response_model=CommentOut)
def edit_comment(ticket_id: int, comment_id: int, data: CommentEditIn,
                 db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = _editable_comment(db, ticket_id, comment_id, current_user)
    comment.body = data.body
    _log_activity(db, ticket_id, current_user.id, "comment_edited", "Note edited")
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{ticket_id}/comments/{comment_id}")
def delete_comment(ticket_id: int, comment_id: int,
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = _editable_comment(db, ticket_id, comment_id, current_user)
    db.delete(comment)
    _log_activity(db, ticket_id, current_user.id, "comment_deleted", "Note deleted")
    db.commit()
    return {"status": "deleted", "id": comment_id}


# ----- Ticket users (additional users beyond the reporter) -----
MAX_ADDITIONAL_USERS = 9


class WatcherIn(BaseModel):
    user_id: int


class WatcherOut(BaseModel):
    id: int
    full_name: str
    email: str

    class Config:
        from_attributes = True


def _watcher_users(db: Session, ticket_id: int):
    """The User rows currently attached to a ticket as additional users."""
    return (
        db.query(User)
        .join(TicketWatcher, TicketWatcher.user_id == User.id)
        .filter(TicketWatcher.ticket_id == ticket_id)
        .order_by(User.full_name)
        .all()
    )


@router.get("/{ticket_id}/watchers", response_model=List[WatcherOut])
def list_watchers(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _watcher_users(db, ticket_id)


@router.post("/{ticket_id}/watchers", response_model=WatcherOut)
def add_watcher(ticket_id: int, data: WatcherIn, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == ticket.reporter_user_id:
        raise HTTPException(status_code=400, detail="That user already opened this ticket")
    existing = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == data.user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already on this ticket")
    if db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket_id).count() >= MAX_ADDITIONAL_USERS:
        raise HTTPException(status_code=400, detail=f"A ticket can have at most {MAX_ADDITIONAL_USERS} additional users")
    db.add(TicketWatcher(ticket_id=ticket_id, user_id=data.user_id))
    _log_activity(db, ticket_id, current_user.id, "user_added", f"Added {user.full_name} to the ticket")
    db.commit()
    return user


@router.delete("/{ticket_id}/watchers/{user_id}")
def remove_watcher(ticket_id: int, user_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    w = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == user_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="User is not on this ticket")
    user = db.query(User).filter(User.id == user_id).first()
    db.delete(w)
    _log_activity(db, ticket_id, current_user.id, "user_removed",
                  f"Removed {user.full_name if user else 'user'} from the ticket")
    db.commit()
    return {"status": "removed", "user_id": user_id}


@router.get("/{ticket_id}/activity", response_model=List[ActivityOut])
def get_activity(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return (
        db.query(TicketActivity)
        .filter(TicketActivity.ticket_id == ticket_id)
        .order_by(TicketActivity.created_at)
        .all()
    )


@router.post("/{ticket_id}/attachments", response_model=AttachmentOut)
def upload_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    comment_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    content = file.file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit",
        )

    # Store under a unique name to avoid collisions and path-traversal via the
    # client-supplied filename; the original name is kept only as metadata.
    original = os.path.basename(file.filename or "file")
    ext = os.path.splitext(original)[1]
    stored_name = f"{uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
        f.write(content)

    attachment = Attachment(
        ticket_id=ticket_id,
        comment_id=comment_id,
        uploaded_by_id=current_user.id,
        filename=original,
        content_type=file.content_type,
        size=len(content),
        stored_name=stored_name,
    )
    db.add(attachment)
    _log_activity(db, ticket_id, current_user.id, "attachment_added", f"Attached {original}")
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{ticket_id}/attachments", response_model=List[AttachmentOut])
def list_attachments(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return (
        db.query(Attachment)
        .filter(Attachment.ticket_id == ticket_id)
        .order_by(Attachment.created_at)
        .all()
    )


@router.get("/{ticket_id}/attachments/{attachment_id}")
def download_attachment(ticket_id: int, attachment_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
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
    return FileResponse(
        path,
        filename=attachment.filename,
        media_type=attachment.content_type or "application/octet-stream",
    )


@router.delete("/{ticket_id}/attachments/{attachment_id}")
def delete_attachment(ticket_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    attachment = (
        db.query(Attachment)
        .filter(Attachment.id == attachment_id, Attachment.ticket_id == ticket_id)
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    path = os.path.join(UPLOAD_DIR, attachment.stored_name)
    if os.path.exists(path):
        os.remove(path)
    _log_activity(db, ticket_id, current_user.id, "attachment_removed", f"Removed {attachment.filename}")
    db.delete(attachment)
    db.commit()
    return {"status": "deleted", "id": attachment_id}

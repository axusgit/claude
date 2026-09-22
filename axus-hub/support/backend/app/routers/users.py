from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.user import User, UserRole
from app.models.ticket import Ticket, TicketComment, TicketActivity, TimeEntry
from app.models.ticket_watcher import TicketWatcher
from app.models.attachment import Attachment
from app.models.magic_token import PortalMagicToken
from app.models.xcitium import XcitiumDirectoryTombstone
from app.auth import get_current_user, hash_password, require_admin
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/users", tags=["users"])


def _user_ref_count(db: Session, uid: int) -> int:
    """How many content rows reference this user (deleting is unsafe when > 0)."""
    return (
        db.query(Ticket).filter(
            (Ticket.created_by_id == uid) | (Ticket.assigned_to_id == uid) | (Ticket.reporter_user_id == uid)
        ).count()
        + db.query(TicketComment).filter(TicketComment.author_id == uid).count()
        + db.query(TicketActivity).filter(TicketActivity.user_id == uid).count()
        + db.query(TimeEntry).filter(TimeEntry.user_id == uid).count()
        + db.query(TicketWatcher).filter(TicketWatcher.user_id == uid).count()
        + db.query(Attachment).filter(Attachment.uploaded_by_id == uid).count()
    )


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str
    phone: Optional[str]
    role: str
    is_active: bool
    client_id: Optional[int]

    class Config:
        from_attributes = True


class UserCreateIn(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str = "technician"
    phone: Optional[str] = None
    client_id: Optional[int] = None


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    client_id: Optional[int] = None


@router.get("/", response_model=List[UserOut])
def list_users(role: Optional[str] = None, include_inactive: bool = False,
               db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List users. Pass ?role=technician to get assignable staff only.

    Deactivated users (e.g. deleted in Xcitium and soft-deleted by the sync) are
    hidden by default; pass ?include_inactive=true to see them.
    """
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
    if not include_inactive:
        q = q.filter(User.is_active == True)  # noqa: E712
    return q.order_by(User.full_name).all()


@router.post("/", response_model=UserOut)
def create_user(data: UserCreateIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        full_name=data.full_name,
        email=data.email,
        hashed_password=hash_password(data.password),
        role=data.role,
        phone=data.phone,
        client_id=data.client_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class PasswordResetIn(BaseModel):
    password: str


@router.put("/{user_id}/password", response_model=UserOut)
def reset_user_password(user_id: int, data: PasswordResetIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    """Admin resets any user's password."""
    new_pw = (data.password or "").strip()
    if len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(new_pw)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdateIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    changes = data.model_dump(exclude_none=True)
    # Guard against email collisions when changing it.
    if "email" in changes and changes["email"] != user.email:
        if db.query(User).filter(User.email == changes["email"]).first():
            raise HTTPException(status_code=400, detail="Email already in use")
    for key, value in changes.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """Delete a user. The identity is TOMBSTONED so the Xcitium directory sync can
    never re-create it. Users with ticket history are deactivated + hidden instead of
    hard-deleted, so their history stays intact."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")

    email = (user.email or "").strip().lower()
    if email and not db.query(XcitiumDirectoryTombstone).filter(
            XcitiumDirectoryTombstone.email == email).first():
        db.add(XcitiumDirectoryTombstone(email=email, xcitium_user_id=user.xcitium_user_id))
    # transient rows that would otherwise block a hard delete
    db.query(PortalMagicToken).filter(PortalMagicToken.user_id == user.id).delete()

    if _user_ref_count(db, user.id) > 0:
        user.is_active = False          # keep the row for ticket history, but hide it
        db.commit()
        return {"status": "deactivated", "id": user_id, "reason": "has ticket history"}
    db.delete(user)
    db.commit()
    return {"status": "deleted", "id": user_id}

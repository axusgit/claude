from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.user import User, UserRole
from app.auth import get_current_user, hash_password, require_admin
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/users", tags=["users"])


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
def list_users(role: Optional[str] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List users. Pass ?role=technician to get assignable staff only."""
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
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

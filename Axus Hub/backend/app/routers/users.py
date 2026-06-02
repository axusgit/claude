from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.user import User
from app.auth import get_current_user
from pydantic import BaseModel

router = APIRouter(prefix="/api/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str
    role: str

    class Config:
        from_attributes = True


@router.get("/", response_model=List[UserOut])
def list_users(role: Optional[str] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List users. Pass ?role=technician to get assignable staff only."""
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
    return q.order_by(User.full_name).all()

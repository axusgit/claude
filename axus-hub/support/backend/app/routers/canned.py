"""Canned responses (staff saved replies) — staff-gated CRUD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.canned import CannedResponse
from app.models.user import User
from app.auth import require_staff, get_current_user

router = APIRouter(prefix="/api/canned", tags=["canned"])


class CannedIn(BaseModel):
    title: str
    body: str


class CannedOut(BaseModel):
    id: int
    title: str
    body: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[CannedOut])
def list_canned(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(CannedResponse).order_by(CannedResponse.title).all()


@router.post("/", response_model=CannedOut)
def create_canned(data: CannedIn, db: Session = Depends(get_db),
                  current_user: User = Depends(require_staff)):
    title = (data.title or "").strip()
    body = (data.body or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Title and body are required.")
    c = CannedResponse(title=title, body=body, created_by_id=current_user.id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.put("/{canned_id}", response_model=CannedOut)
def update_canned(canned_id: int, data: CannedIn, db: Session = Depends(get_db),
                  _=Depends(require_staff)):
    c = db.query(CannedResponse).filter(CannedResponse.id == canned_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Canned response not found")
    c.title = (data.title or "").strip() or c.title
    c.body = (data.body or "").strip() or c.body
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{canned_id}")
def delete_canned(canned_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    c = db.query(CannedResponse).filter(CannedResponse.id == canned_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Canned response not found")
    db.delete(c)
    db.commit()
    return {"status": "deleted", "id": canned_id}

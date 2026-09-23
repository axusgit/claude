"""Glossary (staff-only term/definition reference) — staff-gated CRUD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.glossary import GlossaryTerm
from app.models.user import User
from app.auth import require_staff

router = APIRouter(prefix="/api/glossary", tags=["glossary"])


class TermIn(BaseModel):
    term: str
    definition: str


class TermOut(BaseModel):
    id: int
    term: str
    definition: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Staff-only end to end (the whole tab is staff-only) — no client ever reads this.
@router.get("/", response_model=List[TermOut])
def list_terms(db: Session = Depends(get_db), _=Depends(require_staff)):
    return db.query(GlossaryTerm).order_by(GlossaryTerm.term).all()


@router.post("/", response_model=TermOut)
def create_term(data: TermIn, db: Session = Depends(get_db),
                current_user: User = Depends(require_staff)):
    term = (data.term or "").strip()
    definition = (data.definition or "").strip()
    if not term or not definition:
        raise HTTPException(status_code=400, detail="Term and definition are required.")
    t = GlossaryTerm(term=term, definition=definition, created_by_id=current_user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.put("/{term_id}", response_model=TermOut)
def update_term(term_id: int, data: TermIn, db: Session = Depends(get_db),
                _=Depends(require_staff)):
    t = db.query(GlossaryTerm).filter(GlossaryTerm.id == term_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Term not found")
    t.term = (data.term or "").strip() or t.term
    t.definition = (data.definition or "").strip() or t.definition
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{term_id}")
def delete_term(term_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    t = db.query(GlossaryTerm).filter(GlossaryTerm.id == term_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Term not found")
    db.delete(t)
    db.commit()
    return {"status": "deleted", "id": term_id}

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.ticket import Ticket, TimeEntry, TicketStatus, TicketType
from app.auth import get_current_user
from app.models.user import User
from pydantic import BaseModel

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

STANDARD_HOUR_LIMIT = 8.0


class TicketIn(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    client_id: int
    assigned_to_id: Optional[int] = None


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
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


class TicketOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    status: str
    priority: str
    ticket_type: str
    client_id: int
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
    ticket = Ticket(
        **data.model_dump(),
        created_by_id=current_user.id,
        ticket_type=TicketType.standard,
    )
    db.add(ticket)
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
def update_ticket(ticket_id: int, data: TicketUpdate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    for key, value in data.model_dump(exclude_none=True).items():
        setattr(ticket, key, value)

    # Auto-close timestamp
    if data.status in (TicketStatus.closed, TicketStatus.resolved) and not ticket.closed_at:
        ticket.closed_at = datetime.utcnow()

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
    if ticket.total_hours >= STANDARD_HOUR_LIMIT and ticket.ticket_type == TicketType.standard:
        ticket.ticket_type = TicketType.sow

    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{ticket_id}/time", response_model=List[TimeEntryOut])
def get_time_entries(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TimeEntry).filter(TimeEntry.ticket_id == ticket_id).all()

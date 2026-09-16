"""Read-only endpoints to browse the Xcitium mirror inside Support.

Everything here is read-only; the mirror is populated by app/xcitium_sync.py.
Staff-gated, like the rest of the console.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
import json

from app.database import get_db
from app.auth import require_staff, require_admin
from app.models.xcitium import (
    XcitiumCustomer, XcitiumUser, XcitiumTicket, XcitiumThread,
)
from app import xcitium_sync

router = APIRouter(prefix="/api/xcitium", tags=["xcitium"], dependencies=[Depends(require_staff)])


@router.get("/status")
def sync_status():
    return xcitium_sync.status()


@router.get("/customers")
def list_customers(db: Session = Depends(get_db)):
    counts = dict(
        db.query(XcitiumTicket.organization_name, func.count(XcitiumTicket.id))
        .group_by(XcitiumTicket.organization_name).all()
    )
    rows = db.query(XcitiumCustomer).order_by(XcitiumCustomer.name).all()
    return [{"id": c.id, "name": c.name, "tickets": counts.get(c.name, 0)} for c in rows]


@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    rows = db.query(XcitiumUser).order_by(XcitiumUser.name).all()
    return [{"id": u.id, "external_id": u.external_id, "name": u.name,
             "email": u.email, "organization": u.organization_name} for u in rows]


@router.get("/tickets")
def list_tickets(
    db: Session = Depends(get_db),
    status: Optional[str] = None,
    organization: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
):
    query = db.query(XcitiumTicket)
    if status:
        query = query.filter(XcitiumTicket.status == status)
    if organization:
        query = query.filter(XcitiumTicket.organization_name == organization)
    if q:
        query = query.filter(XcitiumTicket.subject.ilike(f"%{q}%"))
    total = query.count()
    rows = (query.order_by(XcitiumTicket.external_id.desc())
            .offset(offset).limit(limit).all())
    return {
        "total": total, "limit": limit, "offset": offset,
        "tickets": [{
            "external_id": t.external_id, "subject": t.subject, "status": t.status,
            "priority": t.priority, "department": t.department, "category": t.category,
            "organization": t.organization_name, "user": t.username, "email": t.user_email,
            "assignee": t.assignee, "threads": t.thread_count,
            "created": t.create_date.isoformat() if t.create_date else None,
            "updated": t.update_date.isoformat() if t.update_date else None,
        } for t in rows],
    }


@router.get("/tickets/{external_id}")
def ticket_detail(external_id: int, db: Session = Depends(get_db)):
    t = db.query(XcitiumTicket).filter(XcitiumTicket.external_id == external_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not in mirror")
    threads = (db.query(XcitiumThread)
               .filter(XcitiumThread.ticket_external_id == external_id)
               .order_by(XcitiumThread.seq).all())
    return {
        "external_id": t.external_id, "subject": t.subject, "status": t.status,
        "priority": t.priority, "department": t.department, "category": t.category,
        "asset": t.asset, "organization": t.organization_name,
        "user": t.username, "email": t.user_email, "assignee": t.assignee,
        "created": t.create_date.isoformat() if t.create_date else None,
        "updated": t.update_date.isoformat() if t.update_date else None,
        "threads": [{"seq": th.seq,
                     "created": th.created.isoformat() if th.created else None,
                     "poster": th.poster, "title": th.title, "body": th.body}
                    for th in threads],
    }


@router.post("/sync", dependencies=[Depends(require_admin)])
def trigger_sync():
    """Admin-only manual incremental sync (the scheduler runs hourly on its own)."""
    return xcitium_sync.incremental()

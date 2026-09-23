"""Read-only endpoints to browse the Xcitium mirror inside Support.

Everything here is read-only; the mirror is populated by app/xcitium_sync.py.
Staff-gated, like the rest of the console.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
import json
import re as _re
import html as _html

from app.database import get_db
from app.auth import require_staff, require_admin, get_current_user
from app.models.xcitium import (
    XcitiumCustomer, XcitiumUser, XcitiumTicket, XcitiumThread,
)
from app.models.user import User
from app.models.client import Client
from app.models.ticket import Ticket, TicketComment, TicketStatus, TicketPriority, TicketType
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


@router.post("/ticket-numbers", dependencies=[Depends(require_admin)])
async def import_ticket_numbers(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Admin-only: upload a Xcitium ticket-list CSV export to stamp each mirrored
    ticket with its real Xcitium 'Ticket Number' (shown as X-<number>). Re-run after
    every resync to pick up newly-created tickets."""
    from app import xcitium_numbers
    data = await file.read()
    try:
        return xcitium_numbers.apply_numbers(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _x_text(html: str) -> str:
    """Xcitium bodies are HTML emails; render to readable plain text for a comment."""
    if not html:
        return ""
    s = _re.sub(r'(?i)<\s*(br|/p|/div|/li|/tr)\s*/?>', '\n', html)
    s = _re.sub(r'<[^>]+>', '', s)
    s = _html.unescape(s)
    return _re.sub(r'\n{3,}', '\n\n', s).strip()


def _map_status(s: str) -> TicketStatus:
    s = (s or "").lower()
    return TicketStatus.closed if any(k in s for k in ("closed", "resolved", "complete")) else TicketStatus.open


def _map_priority(p: str) -> TicketPriority:
    p = (p or "").lower()
    if any(k in p for k in ("critical", "urgent", "emergency")):
        return TicketPriority.critical
    if "high" in p:
        return TicketPriority.high
    if "low" in p:
        return TicketPriority.low
    return TicketPriority.medium


@router.post("/tickets/{external_id}/promote")
def promote_ticket(external_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    """Convert a read-only mirrored Xcitium ticket into a native, EDITABLE ticket.

    The external id is tombstoned + the mirror row removed, so the hourly sync
    never re-imports or overwrites the edited ticket (Axus is authoritative from
    here until the sync is cut over)."""
    from app.routers.tickets import _log_activity
    from app.models.board import default_board_id

    t = db.query(XcitiumTicket).filter(XcitiumTicket.external_id == external_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not in mirror")

    org = xcitium_sync._remap_org(t.organization_name) if t.organization_name else None
    email = xcitium_sync._remap_email(t.user_email) if t.user_email else None

    def _find_or_make_client(name):
        c = db.query(Client).filter(Client.company_name == name).first()
        if not c:
            c = Client(company_name=name, contact_name="", email="", source="xcitium", is_active=True)
            db.add(c); db.flush()
        return c

    reporter = db.query(User).filter(User.email.ilike(email)).first() if email else None
    if org:
        client = _find_or_make_client(org)
    elif reporter and reporter.client_id:
        client = db.query(Client).filter(Client.id == reporter.client_id).first() or _find_or_make_client("Imported (no business)")
    else:
        client = _find_or_make_client("Imported (no business)")

    threads = (db.query(XcitiumThread)
               .filter(XcitiumThread.ticket_external_id == external_id)
               .order_by(XcitiumThread.seq).all())
    description = _x_text(threads[0].body) if threads else (t.subject or "")

    ticket = Ticket(
        reference=f"X-{t.display_number or external_id}",
        title=t.subject or "(no subject)",
        description=description,
        category=t.category or None,
        status=_map_status(t.status),
        priority=_map_priority(t.priority),
        ticket_type=TicketType.standard,
        origin="xcitium",
        client_id=client.id,
        reporter_user_id=reporter.id if reporter else None,
        created_by_id=current_user.id,
        board_id=default_board_id(db),
    )
    if t.create_date:
        ticket.created_at = t.create_date
    db.add(ticket); db.flush()

    # remaining messages become comments; original poster kept in the body header
    for th in threads[1:]:
        header = f"— {th.poster or '—'}"
        if th.created:
            header += f" · {th.created.strftime('%b %d, %Y %H:%M')}"
        header += " —"
        db.add(TicketComment(ticket_id=ticket.id,
                             author_id=(reporter.id if reporter else current_user.id),
                             body=f"{header}\n\n{_x_text(th.body)}", is_internal=False))

    _log_activity(db, ticket.id, current_user.id, "imported",
                  f"Imported from Xcitium ticket #{external_id} and made editable")
    db.commit()
    # tombstone + drop the mirror row so the sync leaves it alone and no duplicate shows
    xcitium_sync.delete_ticket(external_id)
    return {"id": ticket.id, "reference": ticket.reference}

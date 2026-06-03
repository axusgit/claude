"""Org-wide KPI summary for the Hub command center.

Intentionally unauthenticated at the app level: it returns only aggregate counts
and is reachable from the Hub over the internal Docker network. Publicly it still
sits behind the platform's forward-auth (Traefik), so it is not exposed.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.ticket import Ticket
from app.models.client import Client

router = APIRouter(prefix="/api", tags=["summary"])

ACTIVE = ["open", "in_progress", "waiting"]


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    open_total = db.query(Ticket).filter(Ticket.status.in_(ACTIVE)).count()
    unassigned = db.query(Ticket).filter(Ticket.status.in_(ACTIVE), Ticket.assigned_to_id.is_(None)).count()
    in_progress = db.query(Ticket).filter(Ticket.status == "in_progress").count()
    waiting = db.query(Ticket).filter(Ticket.status == "waiting").count()
    customers = db.query(Client).filter(Client.is_active == True).count()  # noqa: E712
    return {
        "app": "support",
        "headline": {"value": open_total, "label": "Open tickets"},
        "kpis": [
            {"label": "Open tickets", "value": open_total, "tone": "accent"},
            {"label": "Unassigned", "value": unassigned, "tone": "danger" if unassigned else ""},
            {"label": "In progress", "value": in_progress, "tone": ""},
            {"label": "Waiting on client", "value": waiting, "tone": ""},
        ],
        "footnote": f"{customers} active customer{'' if customers == 1 else 's'}",
    }

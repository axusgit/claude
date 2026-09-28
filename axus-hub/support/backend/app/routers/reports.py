"""Ticket trend reports (staff-only): opened vs closed counts per week / month / year
across the WHOLE company — native tickets plus the read-only Xcitium mirror history.

Opened = when a ticket was created (native created_at / mirror create_date).
Closed = when it was closed (native closed_at / mirror update_date, the best close
proxy the mirror carries — every mirror row is already closed).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta

from app.database import get_db
from app.models.ticket import Ticket
from app.models.xcitium import XcitiumTicket
from app.models.user import User
from app.auth import require_staff

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _week_start(d):
    return d - timedelta(days=d.weekday())   # Monday


def _bucket_key(dt, period):
    d = dt.date()
    if period == "week":
        return _week_start(d).isoformat()
    if period == "month":
        return f"{d.year:04d}-{d.month:02d}"
    return f"{d.year:04d}"


def _label(key, period):
    if period == "week":
        return datetime.fromisoformat(key).strftime("%b %d")
    if period == "month":
        return datetime.strptime(key, "%Y-%m").strftime("%b %Y")
    return key


def _display_keys(period, now):
    if period == "week":
        start = _week_start(now.date()) - timedelta(weeks=11)   # last 12 weeks
        return [(start + timedelta(weeks=i)).isoformat() for i in range(12)]
    if period == "month":                                        # last 12 months
        keys, y, m = [], now.year, now.month
        for i in range(11, -1, -1):
            mm, yy = m - i, y
            while mm <= 0:
                mm += 12
                yy -= 1
            keys.append(f"{yy:04d}-{mm:02d}")
        return keys
    return None   # year handled dynamically from the data


@router.get("/ticket-trends")
def ticket_trends(period: str = "month", db: Session = Depends(get_db),
                  _: User = Depends(require_staff)):
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    opened, closed = {}, {}

    def add(bucket, dt):
        dt = _aware(dt)
        if dt is None:
            return
        k = _bucket_key(dt, period)
        bucket[k] = bucket.get(k, 0) + 1

    for t in db.query(Ticket).all():
        add(opened, t.created_at)
        status = str(getattr(t.status, "value", t.status))
        if status == "closed" and t.closed_at:
            add(closed, t.closed_at)

    for xt in db.query(XcitiumTicket).all():
        add(opened, xt.create_date)
        if (xt.status or "") == "closed":
            add(closed, xt.update_date or xt.create_date)

    if period == "year":
        allk = sorted(set(list(opened) + list(closed)))
        keys = allk[-10:] if allk else [f"{now.year:04d}"]
    else:
        keys = _display_keys(period, now)

    buckets = [{"label": _label(k, period),
                "opened": opened.get(k, 0),
                "closed": closed.get(k, 0)} for k in keys]
    return {"period": period, "buckets": buckets}

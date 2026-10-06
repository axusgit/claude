"""Ticket trend reports (staff-only): opened vs closed counts per week / month / year
across the WHOLE company — native tickets plus the read-only Xcitium mirror history.

Opened = when a ticket was created (native created_at / mirror create_date).
Closed = when it was closed (native closed_at / mirror update_date, the best close
proxy the mirror carries — every mirror row is already closed).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func as safunc
from datetime import datetime, timezone, timedelta

from app.database import get_db
from app.models.ticket import Ticket, TicketActivity, TicketStatus
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


# --------------------------------------------------------------------------
# SLA duration reports: time-to-first-assignment and time-to-resolution.
# Each bucketed weekly / monthly / yearly like ticket-trends, reporting the
# average and (outlier-robust) median duration of events that completed in
# that bucket, plus an overall summary.
# --------------------------------------------------------------------------

# Origins that represent a ticket a *client* raised (vs. Axus-initiated work,
# which is usually self-assigned and would skew assignment latency to ~0).
_CLIENT_ORIGINS = {"client_portal", "client_email", "client_phone"}


def _hours(delta):
    return delta.total_seconds() / 3600.0


def _median(vals):
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def _duration_report(period, now, samples):
    """samples: list of (event_dt, hours). Bucket by the event's date and
    return per-bucket count/avg/median plus an overall summary."""
    by_key = {}
    for ev, hrs in samples:
        ev = _aware(ev)
        if ev is None or hrs is None or hrs < 0:
            continue
        by_key.setdefault(_bucket_key(ev, period), []).append(hrs)

    if period == "year":
        allk = sorted(by_key)
        keys = allk[-10:] if allk else [f"{now.year:04d}"]
    else:
        keys = _display_keys(period, now)

    buckets = []
    for k in keys:
        vals = by_key.get(k, [])
        buckets.append({
            "label": _label(k, period),
            "count": len(vals),
            "avg_hours": round(sum(vals) / len(vals), 2) if vals else None,
            "median_hours": round(_median(vals), 2) if vals else None,
        })
    allvals = [h for vs in by_key.values() for h in vs]
    summary = {
        "count": len(allvals),
        "avg_hours": round(sum(allvals) / len(allvals), 2) if allvals else None,
        "median_hours": round(_median(allvals), 2) if allvals else None,
    }
    return {"period": period, "buckets": buckets, "summary": summary}


@router.get("/time-to-assign")
def time_to_assign(period: str = "month", db: Session = Depends(get_db),
                   _: User = Depends(require_staff)):
    """How long a client-opened ticket stays open before it is first assigned
    to an Axus user. Bucketed by the date the ticket was first assigned."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)

    # First time each ticket's assignee was set (the initial null -> user change
    # logs an 'assigned_to_id_changed' activity; the earliest one is the first
    # assignment). Tickets created already-assigned have no such activity.
    first_assign = dict(
        db.query(TicketActivity.ticket_id, safunc.min(TicketActivity.created_at))
        .filter(TicketActivity.action == "assigned_to_id_changed")
        .group_by(TicketActivity.ticket_id)
        .all()
    )

    samples = []
    unassigned_open = 0
    for t in db.query(Ticket).all():
        origin = t.origin or "client_portal"   # pre-origin rows: treat as client
        if origin not in _CLIENT_ORIGINS:
            continue
        created = _aware(t.created_at)
        if created is None:
            continue
        assigned_at = _aware(first_assign.get(t.id))
        if assigned_at is None and t.assigned_to_id:
            assigned_at = created          # assigned at creation -> ~0 latency
        if assigned_at is not None:
            samples.append((assigned_at, _hours(assigned_at - created)))
        elif str(getattr(t.status, "value", t.status)) != "closed":
            unassigned_open += 1           # still waiting for an assignee

    out = _duration_report(period, now, samples)
    out["unassigned_open"] = unassigned_open
    return out


@router.get("/time-to-close")
def time_to_close(period: str = "month", db: Session = Depends(get_db),
                  _: User = Depends(require_staff)):
    """How long a ticket takes from opening to closing. Bucketed by close date.
    Includes the read-only Xcitium mirror history (create_date -> update_date)."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)

    # Exclude tickets that took longer than 30 days to resolve: these long-tail
    # cases (stale/parked tickets, projects) badly skew the average and median and
    # aren't representative of normal resolution time.
    MAX_RESOLUTION_HOURS = 30 * 24

    samples = []
    for t in db.query(Ticket).all():
        # Skip rows imported from Xcitium: their created_at/closed_at are import
        # timestamps, not real open/close times. The authentic history comes from
        # the Xcitium mirror below (real create_date/update_date).
        if (t.origin or "") == "xcitium":
            continue
        if str(getattr(t.status, "value", t.status)) != "closed":
            continue
        created, closed = _aware(t.created_at), _aware(t.closed_at)
        if created and closed:
            hours = _hours(closed - created)
            if hours <= MAX_RESOLUTION_HOURS:
                samples.append((closed, hours))

    for xt in db.query(XcitiumTicket).all():
        if (xt.status or "") != "closed":
            continue
        created, closed = _aware(xt.create_date), _aware(xt.update_date or xt.create_date)
        if created and closed:
            hours = _hours(closed - created)
            if hours <= MAX_RESOLUTION_HOURS:
                samples.append((closed, hours))

    return _duration_report(period, now, samples)

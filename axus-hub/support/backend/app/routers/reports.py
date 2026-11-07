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
from zoneinfo import ZoneInfo

from app.database import get_db
from app.models.ticket import Ticket, TicketActivity, TicketStatus
from app.models.xcitium import XcitiumTicket
from app.models.user import User
from app.models.client import Client
from app.auth import require_staff

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Axus operates on US Eastern time; ticket timestamps are stored UTC, so the
# "time of day" / "day of week" reports convert to Eastern before bucketing.
_ET = ZoneInfo("America/New_York")
# Monday..Sunday to match Python's datetime.weekday() (Mon=0 .. Sun=6).
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _company_filter(db, company):
    """Build (native_ok, xcitium_ok) predicates for an optional company-name
    filter. company falsy/blank -> include everything. Matching is by the same
    display label the 'tickets by company' report uses, so a native client and
    the Xcitium mirror's organization of the same name are filtered together."""
    if not company or not company.strip():
        return (lambda t: True), (lambda xt: True)
    target = company.strip()
    client_names = dict(db.query(Client.id, Client.company_name).all())
    canon = {}
    for name in client_names.values():
        if name:
            canon.setdefault(name.strip().lower(), name)

    def native_ok(t):
        return (client_names.get(t.client_id) or f"#{t.client_id}") == target

    def xcitium_ok(xt):
        org = (xt.organization_name or "").strip()
        label = canon.get(org.lower(), org) if org else "(Unknown)"
        return label == target

    return native_ok, xcitium_ok


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


def _window_start(period, now):
    """Lower bound on created_at matching the window the trend charts display
    (last 12 weeks / last 12 months). None for 'year' = all-time."""
    if period == "week":
        d = _week_start(now.date()) - timedelta(weeks=11)
        return _aware(datetime(d.year, d.month, d.day))
    if period == "month":
        total = (now.year * 12 + (now.month - 1)) - 11   # 11 months back, inclusive
        yy, mm = divmod(total, 12)
        return _aware(datetime(yy, mm + 1, 1))
    return None


@router.get("/ticket-trends")
def ticket_trends(period: str = "month", company: str | None = None,
                  db: Session = Depends(get_db),
                  _: User = Depends(require_staff)):
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    native_ok, xcitium_ok = _company_filter(db, company)
    opened, closed = {}, {}

    def add(bucket, dt):
        dt = _aware(dt)
        if dt is None:
            return
        k = _bucket_key(dt, period)
        bucket[k] = bucket.get(k, 0) + 1

    for t in db.query(Ticket).all():
        if not native_ok(t):
            continue
        add(opened, t.created_at)
        status = str(getattr(t.status, "value", t.status))
        if status == "closed" and t.closed_at:
            add(closed, t.closed_at)

    for xt in db.query(XcitiumTicket).all():
        if not xcitium_ok(xt):
            continue
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
def time_to_assign(period: str = "month", company: str | None = None,
                   db: Session = Depends(get_db),
                   _: User = Depends(require_staff)):
    """How long a client-opened ticket stays open before it is first assigned
    to an Axus user. Bucketed by the date the ticket was first assigned."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    native_ok, _xok = _company_filter(db, company)

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
        if not native_ok(t):
            continue
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
def time_to_close(period: str = "month", company: str | None = None,
                  db: Session = Depends(get_db),
                  _: User = Depends(require_staff)):
    """How long a ticket takes from opening to closing. Bucketed by close date.
    Includes the read-only Xcitium mirror history (create_date -> update_date)."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    native_ok, xcitium_ok = _company_filter(db, company)

    # Exclude tickets that took longer than 30 days to resolve: these long-tail
    # cases (stale/parked tickets, projects) badly skew the average and median and
    # aren't representative of normal resolution time.
    MAX_RESOLUTION_HOURS = 30 * 24

    samples = []
    for t in db.query(Ticket).all():
        if not native_ok(t):
            continue
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
        if not xcitium_ok(xt):
            continue
        if (xt.status or "") != "closed":
            continue
        created, closed = _aware(xt.create_date), _aware(xt.update_date or xt.create_date)
        if created and closed:
            hours = _hours(closed - created)
            if hours <= MAX_RESOLUTION_HOURS:
                samples.append((closed, hours))

    return _duration_report(period, now, samples)


@router.get("/tickets-by-company")
def tickets_by_company(period: str = "month", company: str | None = None,
                       db: Session = Depends(get_db),
                       _: User = Depends(require_staff)):
    """Opened vs. closed ticket counts per company (Business) during the period,
    ranked by total activity: the top 11 companies plus an aggregated 'Others'
    bucket. This is a throughput view (the per-company decomposition of the
    ticket-trends chart): Opened = tickets created in the window, Closed =
    tickets closed in the window; a ticket opened and later closed within the
    window counts in both. Includes the read-only Xcitium mirror history.
    Window matches the trend charts (last 12 weeks / 12 months; 'year' = all)."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    start = _window_start(period, now)

    # Company-name lookups: native client_id -> name, plus a case-insensitive
    # map so the Xcitium mirror's organization_name merges into the same company.
    client_names = dict(db.query(Client.id, Client.company_name).all())
    canon = {}
    for name in client_names.values():
        if name:
            canon.setdefault(name.strip().lower(), name)

    counts = {}   # company label -> [opened, closed]
    target = company.strip() if company and company.strip() else None

    def in_window(dt):
        dt = _aware(dt)
        return dt is not None and (start is None or dt >= start)

    def add(label, idx):
        if target is not None and label != target:
            return
        counts.setdefault(label, [0, 0])[idx] += 1

    # Native tickets (all origins; origin=="xcitium" rows are distinct from the
    # mirror -- verified zero ref overlap). Opened = created in window; Closed =
    # closed in window.
    for t in db.query(Ticket).all():
        label = client_names.get(t.client_id) or f"#{t.client_id}"
        if in_window(t.created_at):
            add(label, 0)
        status = str(getattr(t.status, "value", t.status))
        if status == "closed" and in_window(t.closed_at):
            add(label, 1)

    # Xcitium legacy mirror (read-only). Map org name onto the matching native
    # company; blank org -> Unknown. Opened by create_date, closed by update_date
    # (the mirror's close proxy) -- same as the ticket-trends chart.
    for xt in db.query(XcitiumTicket).all():
        org = (xt.organization_name or "").strip()
        label = canon.get(org.lower(), org) if org else "(Unknown)"
        if in_window(xt.create_date):
            add(label, 0)
        if (xt.status or "").lower() == "closed" and in_window(xt.update_date or xt.create_date):
            add(label, 1)

    # Untagged legacy tickets (no org on the Xcitium side) aren't a real company,
    # so keep "(Unknown)" out of the ranking -- its tickets are folded into Others
    # instead, leaving every top slot for an actual company.
    unknown = counts.pop("(Unknown)", [0, 0])

    rows = [{"label": lbl, "opened": o, "closed": c, "total": o + c}
            for lbl, (o, c) in counts.items()]
    rows.sort(key=lambda r: (r["total"], r["opened"]), reverse=True)

    TOP = 11
    top, rest = rows[:TOP], rows[TOP:]
    others_opened = sum(r["opened"] for r in rest) + unknown[0]
    others_closed = sum(r["closed"] for r in rest) + unknown[1]
    if rest or others_opened or others_closed:
        top.append({
            "label": f"Others ({len(rest)})",
            "opened": others_opened,
            "closed": others_closed,
            "total": others_opened + others_closed,
        })
    return {"period": period, "companies": top}


def _hour_label(h):
    """0..23 -> '12a', '1a', ... '12p', '1p', ... '11p'."""
    suffix = "a" if h < 12 else "p"
    hour12 = h % 12 or 12
    return f"{hour12}{suffix}"


@router.get("/opened-by-hour")
def opened_by_hour(period: str = "month", company: str | None = None,
                   db: Session = Depends(get_db),
                   _: User = Depends(require_staff)):
    """When (hour of day, US Eastern) tickets get OPENED — the intake pattern.
    Opens only; closes are deliberately excluded. Counts native tickets created
    in the window, bucketed into 24 hours of the day in Eastern time.

    Rows imported from Xcitium (origin == 'xcitium') are excluded: their
    created_at is the import timestamp, not the real open time. The live Xcitium
    mirror is also excluded here because its timestamps are of uncertain timezone
    and (being ~35x the native volume) would swamp the real intake signal. This
    report therefore reflects the current native intake (portal / email / phone).
    Window matches the other reports (last 12 weeks / 12 months; 'year' = all)."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    start = _window_start(period, now)
    native_ok, _xok = _company_filter(db, company)

    counts = [0] * 24
    total = 0
    for t in db.query(Ticket).all():
        if not native_ok(t):
            continue
        if (t.origin or "") == "xcitium":
            continue
        dt = _aware(t.created_at)
        if dt is None or (start is not None and dt < start):
            continue
        counts[dt.astimezone(_ET).hour] += 1
        total += 1

    peak = max(range(24), key=lambda h: counts[h]) if total else None
    hours = [{"hour": h, "label": _hour_label(h), "count": counts[h]}
             for h in range(24)]
    return {
        "period": period,
        "total": total,
        "peak_hour": peak,
        "peak_label": _hour_label(peak) if peak is not None else None,
        "hours": hours,
    }


@router.get("/opened-by-weekday")
def opened_by_weekday(period: str = "month", company: str | None = None,
                      db: Session = Depends(get_db),
                      _: User = Depends(require_staff)):
    """When (day of week, US Eastern) tickets get OPENED — the weekly intake
    pattern, Monday..Sunday. Opens only; same scope as opened-by-hour: native
    intake, Xcitium-origin/import rows excluded, UTC->Eastern, honoring the
    period window and the optional company filter."""
    if period not in ("week", "month", "year"):
        period = "month"
    now = datetime.now(timezone.utc)
    start = _window_start(period, now)
    native_ok, _xok = _company_filter(db, company)

    counts = [0] * 7
    total = 0
    for t in db.query(Ticket).all():
        if not native_ok(t):
            continue
        if (t.origin or "") == "xcitium":
            continue
        dt = _aware(t.created_at)
        if dt is None or (start is not None and dt < start):
            continue
        counts[dt.astimezone(_ET).weekday()] += 1
        total += 1

    peak = max(range(7), key=lambda d: counts[d]) if total else None
    days = [{"day": d, "label": _WEEKDAYS[d], "count": counts[d]} for d in range(7)]
    return {
        "period": period,
        "total": total,
        "peak_day": peak,
        "peak_label": _WEEKDAYS[peak] if peak is not None else None,
        "days": days,
    }


@router.get("/companies")
def report_companies(db: Session = Depends(get_db),
                     _: User = Depends(require_staff)):
    """Distinct companies (Businesses) that have any ticket activity — native or
    Xcitium mirror — for the Reports company filter. Sorted A->Z; the UI prepends
    an 'All companies' option. Each label is passed back verbatim as the
    ?company= filter on the other report endpoints. '(Unknown)' legacy rows are
    omitted (not a real business; they still count under 'All companies')."""
    client_names = dict(db.query(Client.id, Client.company_name).all())
    canon = {}
    for name in client_names.values():
        if name:
            canon.setdefault(name.strip().lower(), name)

    labels = set()
    for (cid,) in db.query(Ticket.client_id).distinct():
        labels.add(client_names.get(cid) or f"#{cid}")
    for (org,) in db.query(XcitiumTicket.organization_name).distinct():
        o = (org or "").strip()
        if o:
            labels.add(canon.get(o.lower(), o))
    labels.discard("(Unknown)")

    return {"companies": sorted(labels, key=lambda s: s.lower())}

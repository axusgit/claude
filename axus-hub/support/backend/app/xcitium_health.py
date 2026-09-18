"""Persistent health monitor for the legacy Xcitium (Comodo) Service Desk clientapi.

The Xcitium hosted backend fails frequently -- its PHP app periodically cannot reach
its own MySQL host and returns an HTML PDOException ("getaddrinfo failed") with HTTP
200 instead of JSON. This monitor runs forever in a background thread inside the
always-on Support container, probes the API on an interval, and EMAILS on every state
transition (up->down and down->up) -- never on every check, and never twice for the
same outage. State is persisted in the xcitium_health table so it survives restarts.

Email goes out via Support's existing Microsoft Graph client (app/graph.py); if Graph
isn't configured the transition is still logged, just not emailed.

Independent of the ticket mirror sync (app/xcitium_sync.py): it needs only the
Xcitium API key, and keeps watching whether or not XCITIUM_SYNC_ENABLED is set.
"""
import os
import time
import smtplib
import ssl
import threading
from datetime import datetime
from email.message import EmailMessage

import httpx

from app.database import SessionLocal
from app.models.xcitium import XcitiumHealth
from app import xcitium

CHECK_INTERVAL = int(os.getenv("XCITIUM_HEALTH_SECONDS", "600"))   # 10 min
DOWN_CONFIRM = int(os.getenv("XCITIUM_HEALTH_DOWN_CONFIRM", "2"))  # consecutive fails -> DOWN
ALERT_TO = os.getenv("XCITIUM_ALERT_EMAIL", "acarr@axustechnologies.com")
PROBE_TICKET_ID = os.getenv("XCITIUM_HEALTH_PROBE_ID", "100")

# Outbound email via SMTP (the platform's existing O365 relay, wired from the
# AUTHENTIK_EMAIL__* creds in infra/.env). Falls back to Graph, then to logging.
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() in ("1", "true", "yes")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")


# ---------- probe ----------

def probe():
    """One lightweight, no-retry health check. Returns (ok: bool, detail: str).

    up   = the app booted and answered with JSON (even a 401 means it reached auth,
           i.e. its DB is fine).
    down = HTML/error body or a transport error (the classic 200+PDOException page,
           or a timeout / 5xx)."""
    if not xcitium.is_configured():
        return None, "XCITIUM_API_KEY not configured"
    try:
        r = httpx.post(
            xcitium.BASE, params={"serviceName": "viewticket"},
            headers={"Content-Type": "application/json", "Authorization": xcitium.API_KEY},
            json={"ticketId": str(PROBE_TICKET_ID)}, timeout=20,
        )
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    try:
        body = r.json()
    except ValueError:
        text = r.text or ""
        if "getaddrinfo" in text or "PDOException" in text:
            reason = "backend DB unreachable (Comodo-side PDOException)"
        else:
            reason = f"non-JSON response (HTTP {r.status_code})"
        return False, reason
    return True, f"HTTP {r.status_code}, code {body.get('code')}"


# ---------- state ----------

def _row(db) -> XcitiumHealth:
    h = db.query(XcitiumHealth).filter(XcitiumHealth.id == 1).first()
    if not h:
        h = XcitiumHealth(id=1, state=None, consecutive_fails=0)
        db.add(h)
        db.commit()
        db.refresh(h)
    return h


def _fmt_duration(delta) -> str:
    secs = int(delta.total_seconds())
    if secs < 3600:
        return f"{secs // 60} min"
    if secs < 86400:
        return f"{secs // 3600}h {secs % 3600 // 60}m"
    return f"{secs // 86400}d {secs % 86400 // 3600}h"


# ---------- alerts ----------

def _send_smtp(subject, body):
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = ALERT_TO
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if SMTP_USE_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=30) as s:
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
            s.ehlo()
            if SMTP_USE_TLS:
                s.starttls(context=ctx)
                s.ehlo()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)


def _send(subject, body):
    """Send an alert. Prefer the SMTP relay; fall back to Graph; else just log."""
    if SMTP_HOST:
        try:
            _send_smtp(subject, body)
            print(f"[xcitium-health] emailed {ALERT_TO} via SMTP: {subject}", flush=True)
            return
        except Exception as e:
            print(f"[xcitium-health] SMTP send FAILED ({e}); trying Graph", flush=True)
    try:
        from app import graph
        if graph.is_configured():
            graph.send_mail(ALERT_TO, subject, body)
            print(f"[xcitium-health] emailed {ALERT_TO} via Graph: {subject}", flush=True)
            return
    except Exception as e:
        print(f"[xcitium-health] Graph send FAILED: {e}", flush=True)
    print(f"[xcitium-health] (no email transport) {subject}", flush=True)


def _alert_down(detail, now):
    _send(
        "⚠️ Xcitium Service Desk is DOWN",
        "Automated monitor: the Xcitium (Comodo) Service Desk API is not responding.\n\n"
        f"Detected: {now:%Y-%m-%d %H:%M UTC}\n"
        f"Reason:   {detail}\n\n"
        "This is a Comodo-side outage (their app can't reach its own database) -- there is\n"
        "nothing to fix on the Axus side. The Axus Service Desk page keeps serving the\n"
        "cached mirror, and the hourly sync will automatically catch up once Xcitium is back.\n\n"
        "You'll get a follow-up email the moment it recovers.\n"
    )


def _alert_up(down_since, now):
    dur = _fmt_duration(now - down_since) if down_since else "unknown"
    _send(
        "✅ Xcitium Service Desk recovered",
        "Automated monitor: the Xcitium (Comodo) Service Desk API is responding with valid\n"
        "JSON again.\n\n"
        f"Recovered: {now:%Y-%m-%d %H:%M UTC}\n"
        f"Down for:  ~{dur}\n\n"
        "The hourly mirror sync will pull in anything that changed during the outage. If you\n"
        "were waiting to clean up users in Xcitium, it should be usable again now.\n"
    )


# ---------- monitor loop ----------

def check_once():
    """Run one probe, persist state, and email on a transition. Returns a small dict."""
    ok, detail = probe()
    if ok is None:
        return {"state": None, "detail": detail}   # not configured -> nothing to do
    db = SessionLocal()
    try:
        h = _row(db)
        now = datetime.utcnow()
        prev = h.state
        h.last_checked_at = now
        transition = None
        if ok:
            h.consecutive_fails = 0
            h.last_error = None
            if prev != "up":
                if prev == "down":
                    _alert_up(h.since, now)
                    transition = "down->up"
                else:  # first ever check and it's up -> initialize silently
                    transition = "init-up"
                h.state = "up"
                h.since = now
        else:
            h.consecutive_fails = (h.consecutive_fails or 0) + 1
            h.last_error = detail
            if prev != "down" and h.consecutive_fails >= DOWN_CONFIRM:
                _alert_down(detail, now)
                transition = "up->down" if prev == "up" else "init-down"
                h.state = "down"
                h.since = now
        db.commit()
        return {"state": h.state, "ok": ok, "detail": detail,
                "consecutive_fails": h.consecutive_fails, "transition": transition}
    finally:
        db.close()


def run_monitor():
    print(f"[xcitium-health] monitor started (every {CHECK_INTERVAL}s, "
          f"down-confirm={DOWN_CONFIRM}, alerts -> {ALERT_TO})", flush=True)
    while True:
        try:
            res = check_once()
            if res.get("transition"):
                print(f"[xcitium-health] transition: {res}", flush=True)
        except Exception as e:
            print(f"[xcitium-health] check error (will retry): {e}", flush=True)
        time.sleep(CHECK_INTERVAL)


def start_monitor_thread():
    threading.Thread(target=run_monitor, daemon=True, name="xcitium-health").start()


def status():
    db = SessionLocal()
    try:
        h = _row(db)
        return {
            "state": h.state,
            "since": h.since.isoformat() if h.since else None,
            "last_checked_at": h.last_checked_at.isoformat() if h.last_checked_at else None,
            "last_error": h.last_error,
            "consecutive_fails": h.consecutive_fails,
            "alert_to": ALERT_TO,
            "interval_seconds": CHECK_INTERVAL,
        }
    finally:
        db.close()


if __name__ == "__main__":
    import sys, json
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "check":
        print(json.dumps(check_once(), indent=2, default=str))
    elif cmd == "probe":
        ok, detail = probe()
        print(json.dumps({"ok": ok, "detail": detail}, indent=2))
    else:
        print(json.dumps(status(), indent=2, default=str))

"""Archive retention: permanently purge tickets that have sat in the Archive
(recycle bin) longer than the retention window.

A ticket is "archived" (soft-deleted) by setting Ticket.archived_at. Staff can
restore it or delete it permanently at any time; otherwise this daemon removes it
automatically once it is older than ARCHIVE_RETENTION_DAYS (default 30).
"""
import os
import time
import threading
from datetime import datetime, timezone, timedelta

from app.database import SessionLocal
from app.models.ticket import Ticket

RETENTION_DAYS = int(os.getenv("ARCHIVE_RETENTION_DAYS", "30"))
# How often to sweep. Default every 6 hours; the window is days, so this is plenty.
CHECK_INTERVAL_SEC = int(os.getenv("ARCHIVE_PURGE_INTERVAL_SEC", str(6 * 3600)))


def purge_expired(db=None) -> int:
    """Permanently delete every archived ticket past the retention window.
    Returns the number purged."""
    own = db is None
    if own:
        db = SessionLocal()
    try:
        from app.routers.tickets import _purge_ticket  # deferred: avoids import cycle
        cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
        expired = (db.query(Ticket)
                   .filter(Ticket.archived_at.isnot(None), Ticket.archived_at < cutoff)
                   .all())
        n = 0
        for t in expired:
            _purge_ticket(db, t)
            n += 1
        if n:
            db.commit()
            print(f"[archive] purged {n} ticket(s) past the {RETENTION_DAYS}-day "
                  f"retention window", flush=True)
        return n
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        print(f"[archive] purge failed: {e}", flush=True)
        return 0
    finally:
        if own:
            db.close()


def run_scheduler():
    # Sweep once shortly after startup, then on the interval.
    while True:
        try:
            purge_expired()
        except Exception as e:
            print(f"[archive] scheduler error: {e}", flush=True)
        time.sleep(CHECK_INTERVAL_SEC)


def start_scheduler_thread():
    threading.Thread(target=run_scheduler, daemon=True, name="archive-purge").start()

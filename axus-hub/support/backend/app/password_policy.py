"""Client-portal password policy — the single source of truth for complexity,
history, lockout and expiry rules. Used by both the portal auth endpoints
(client self-service) and the staff endpoints (set/reset a temp password).

Spec (locked 2026-09-28, see memory axus-support-client-password-login):
  * min 8 chars, requires upper + lower + number + special
  * cannot reuse the last 5 passwords
  * 5 failed logins -> 15-minute lockout
  * 90-day expiry, 7-day advance warning, first login forces a change
"""
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password
from app.models.client_password import ClientPasswordHistory

MIN_LEN = 8
HISTORY_DEPTH = 5
MAX_FAILS = 5
LOCKOUT_MIN = 15
EXPIRY_DAYS = 90
WARN_DAYS = 7

_SPECIAL = r"""!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~"""


def validate_complexity(pw: str) -> Optional[str]:
    """Return an error message if the password fails the policy, else None."""
    pw = pw or ""
    if len(pw) < MIN_LEN:
        return f"Password must be at least {MIN_LEN} characters."
    if not re.search(r"[A-Z]", pw):
        return "Password must include an uppercase letter."
    if not re.search(r"[a-z]", pw):
        return "Password must include a lowercase letter."
    if not re.search(r"[0-9]", pw):
        return "Password must include a number."
    if not re.search(f"[{re.escape(_SPECIAL)}]", pw):
        return "Password must include a special character."
    return None


def reused_recently(db: Session, user_id: int, pw: str, current_hash: str = "") -> bool:
    """True if pw matches the current password or any of the last HISTORY_DEPTH."""
    if current_hash and verify_password(pw, current_hash):
        return True
    rows = (db.query(ClientPasswordHistory)
            .filter(ClientPasswordHistory.user_id == user_id)
            .order_by(ClientPasswordHistory.created_at.desc())
            .limit(HISTORY_DEPTH).all())
    return any(verify_password(pw, r.hashed_password) for r in rows)


def record_password(db: Session, user, pw: str) -> None:
    """Hash + set the user's password, stamp password_set_at, clear must-change,
    and append to history (trimming to HISTORY_DEPTH). Does NOT commit."""
    hashed = hash_password(pw)
    user.hashed_password = hashed
    user.password_set_at = datetime.now(timezone.utc)
    user.must_change_password = False
    db.add(ClientPasswordHistory(user_id=user.id, hashed_password=hashed))
    # keep history bounded
    old = (db.query(ClientPasswordHistory)
           .filter(ClientPasswordHistory.user_id == user.id)
           .order_by(ClientPasswordHistory.created_at.desc())
           .offset(HISTORY_DEPTH + 1).all())
    for r in old:
        db.delete(r)


def days_until_expiry(user) -> Optional[int]:
    """Whole days until the password expires (negative if already expired), or
    None if the user has no password set."""
    if not user.password_set_at:
        return None
    exp = user.password_set_at + timedelta(days=EXPIRY_DAYS)
    now = datetime.now(timezone.utc)
    return int((exp - now).total_seconds() // 86400)


def is_expired(user) -> bool:
    d = days_until_expiry(user)
    return d is not None and d < 0


def expiry_warning(user) -> Optional[str]:
    """A '... expires in N days' message when inside the warning window, else None."""
    d = days_until_expiry(user)
    if d is None or d < 0 or d > WARN_DAYS:
        return None
    if d == 0:
        return "Your password expires today. Please set a new one."
    return f"Your password expires in {d} day{'s' if d != 1 else ''}. Please set a new one soon."


# ----- in-process brute-force lockout (keyed by lowercased email) -----
# A restart clears lockouts; acceptable for this protection level and matches the
# single-worker uvicorn container.
_fails: dict = {}   # email -> {"count": int, "locked_until": float}


def lockout_remaining(email: str) -> int:
    """Seconds remaining on an active lockout for this email, else 0."""
    rec = _fails.get((email or "").lower())
    if not rec:
        return 0
    rem = rec.get("locked_until", 0) - time.time()
    return int(rem) if rem > 0 else 0


def register_failure(email: str) -> int:
    """Count a failed login; lock after MAX_FAILS. Returns seconds locked (0 if not)."""
    key = (email or "").lower()
    rec = _fails.get(key) or {"count": 0, "locked_until": 0}
    rec["count"] += 1
    if rec["count"] >= MAX_FAILS:
        rec["locked_until"] = time.time() + LOCKOUT_MIN * 60
        rec["count"] = 0
    _fails[key] = rec
    return lockout_remaining(email)


def clear_failures(email: str) -> None:
    _fails.pop((email or "").lower(), None)

"""Secure onboarding-portal tokens (Support magic-link approach).

Only the SHA-256 hash is stored; the raw token travels only in the emailed link.
An onboarding token is reusable within its TTL (a vendor may return to finish) and
is revocable — issuing a new one revokes the vendor's prior active tokens, which is
how "send a replacement link" works. A token identifies exactly one subcontractor,
so the portal must scope every query by the resolved subcontractor's id.
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.onboarding_token import OnboardingToken
from app.models.subcontractor import Subcontractor

TTL_DAYS = int(os.getenv("ONBOARDING_TOKEN_TTL_DAYS", "30"))


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_token(db: Session, subcontractor_id: int, ttl_days: int = None) -> str:
    """Revoke any active tokens for this vendor, then create and return a new raw
    token (caller emails it). The raw value is never persisted."""
    now = datetime.now(timezone.utc)
    db.query(OnboardingToken).filter(
        OnboardingToken.subcontractor_id == subcontractor_id,
        OnboardingToken.revoked_at.is_(None),
    ).update({OnboardingToken.revoked_at: now})
    raw = secrets.token_urlsafe(32)
    row = OnboardingToken(
        subcontractor_id=subcontractor_id,
        token_hash=hash_token(raw),
        expires_at=now + timedelta(days=ttl_days or TTL_DAYS),
    )
    db.add(row)
    return raw


def resolve_token(db: Session, raw: str) -> Subcontractor | None:
    """Return the subcontractor for a valid token (not revoked, not expired), or
    None. Records last_used_at. Does NOT commit."""
    if not raw:
        return None
    row = db.query(OnboardingToken).filter(
        OnboardingToken.token_hash == hash_token(raw)
    ).first()
    if row is None or row.revoked_at is not None:
        return None
    now = datetime.now(timezone.utc)
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        return None
    row.last_used_at = now
    sub = db.query(Subcontractor).filter(
        Subcontractor.id == row.subcontractor_id,
        Subcontractor.deleted_at.is_(None),
    ).first()
    return sub

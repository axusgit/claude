"""Secure onboarding-portal access tokens.

Follows Support's magic-link approach: only the SHA-256 hash of the token is
stored, so a DB leak can't be used to access the portal; the raw token travels
only in the emailed link. Unlike a login magic-link, an onboarding token is
REUSABLE within its validity window (a vendor may return to finish), so it is not
marked single-use — instead it can be revoked and replaced (issue a new one).

The token securely identifies exactly one subcontractor; the portal must scope
every query to `subcontractor_id` so Vendor A's token can never expose Vendor B.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.database import Base


class OnboardingToken(Base):
    __tablename__ = "onboarding_tokens"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)  # sha256 of raw token
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)  # set when replaced/cancelled

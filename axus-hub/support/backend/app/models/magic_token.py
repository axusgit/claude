"""Single-use, short-lived sign-in tokens for the passwordless customer portal.

Only the SHA-256 hash of the token is stored, so a DB leak can't be used to log in.
The raw token travels only in the emailed magic link.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class PortalMagicToken(Base):
    __tablename__ = "portal_magic_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)  # sha256 of raw token
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)   # set once when redeemed (single-use)

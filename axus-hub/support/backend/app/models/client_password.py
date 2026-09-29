from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class ClientPasswordHistory(Base):
    """Prior password hashes for a client-portal user, so a new password can be
    checked against the last N (see password_policy.HISTORY_DEPTH) and reuse
    refused. One row is written each time a password is set or changed."""
    __tablename__ = "client_password_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

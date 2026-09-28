"""Per-recipient outbound email log (modeled on aesign's email_log — Support has
none). Records every send attempt so compliance correspondence is auditable
(spec §EMAIL AUTOMATION). Content is never stored here — only metadata.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.database import Base

EMAIL_STATUSES = ["sent", "failed", "skipped"]


class EmailLog(Base):
    __tablename__ = "email_log"

    id = Column(Integer, primary_key=True, index=True)
    # Nullable for internal compliance alerts not tied to a single vendor.
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=True, index=True)
    request_id = Column(Integer, ForeignKey("document_requests.id"), nullable=True, index=True)

    recipient = Column(String, nullable=False)
    email_type = Column(String, nullable=False, index=True)  # e.g. onboarding_invite, coi_renewal
    subject = Column(String, nullable=True)
    status = Column(String, nullable=False, default="sent")
    error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

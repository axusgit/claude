"""Reminder/request state machine — the backbone of idempotent automation.

One row tracks an outstanding request (onboarding completion, COI renewal, or
agreement renewal) and its reminder cadence. The daily compliance job reads
`next_notification_at` to decide whether a reminder is due, so running the job
multiple times a day never sends duplicates (spec §AUTOMATION ENGINE). State
transitions (open -> awaiting_review -> completed/cancelled) stop the reminders.
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.database import Base

REQUEST_TYPES = ["onboarding", "coi_renewal", "agreement_renewal"]
REQUEST_STATUSES = ["open", "awaiting_review", "completed", "cancelled"]


class DocumentRequest(Base):
    __tablename__ = "document_requests"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)

    request_type = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="open", index=True)

    # What this request is tied to, e.g. the COI expiration or agreement renewal date.
    due_date = Column(Date, nullable=True)

    # Reminder cadence / idempotency fields (spec §AUTOMATION ENGINE)
    request_created_at = Column(DateTime(timezone=True), server_default=func.now())
    first_notification_at = Column(DateTime(timezone=True), nullable=True)
    last_notification_at = Column(DateTime(timezone=True), nullable=True)
    next_notification_at = Column(DateTime(timezone=True), nullable=True, index=True)
    reminder_count = Column(Integer, nullable=False, default=0)

    completed_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

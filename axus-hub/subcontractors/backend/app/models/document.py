"""Versioned compliance documents (W-9 and COI).

Documents are NEVER overwritten — each upload is a new row with an incrementing
`version`, so the full history is retained (spec §DOCUMENT HISTORY). The file
itself is stored on disk under an opaque `stored_name` in the app's data volume;
the original filename is kept only for display. Downloads are always served
through a permission-gated route, never a public URL.

W-9 handling note: this row holds only metadata + a pointer to the stored file.
Taxpayer identification data lives inside the file, which is access-controlled
(P_VIEW_W9) and must never appear in logs, emails, or directory views.
"""
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base

DOC_TYPES = ["w9", "coi"]

# W-9 statuses (spec): missing / received / pending_review / approved / rejected
# COI statuses (spec): missing / pending_review / current / expiring_soon / expired / rejected
DOC_STATUSES = [
    "missing", "received", "pending_review", "approved", "rejected",
    "current", "expiring_soon", "expired",
]


class SubcontractorDocument(Base):
    __tablename__ = "subcontractor_documents"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)

    doc_type = Column(String, nullable=False, index=True)  # w9 | coi
    version = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="pending_review", index=True)

    # COI-specific coverage dates (nullable for W-9)
    effective_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True, index=True)

    # Stored file (opaque name on disk; original kept for display only)
    stored_name = Column(String, nullable=False)
    original_filename = Column(String, nullable=True)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)

    uploaded_by = Column(String, nullable=True)   # "subcontractor" or a staff email
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    reviewed_by = Column(String, nullable=True)    # actor email
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_notes = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subcontractor = relationship("Subcontractor", back_populates="documents")

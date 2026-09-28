"""The core subcontractor/vendor directory record.

Holds the directory fields plus denormalized quick-view compliance columns
(w9_status / coi_status / coi_expiration_date / agreement_* / compliance_status)
that the daily compliance engine keeps in sync from the authoritative rows in
`subcontractor_documents` and `agreement_links`. Storing them here keeps the
directory list and dashboard queries cheap.
"""
from sqlalchemy import Column, Integer, String, Text, Date, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base

# Vendor lifecycle statuses (spec §VENDOR STATUS). Stored as plain strings so the
# option set can evolve without an enum migration (Support's convention).
VENDOR_STATUSES = [
    "invited", "onboarding", "pending_review", "approved",
    "missing_documents", "expiring_soon", "non_compliant",
    "on_hold", "inactive",
]

# Rolled-up compliance state, computed by the engine (spec §OVERALL COMPLIANCE).
COMPLIANCE_STATUSES = ["compliant", "expiring_soon", "non_compliant", "pending", "unknown"]


class Subcontractor(Base):
    __tablename__ = "subcontractors"

    id = Column(Integer, primary_key=True, index=True)
    # Permanent human ID, e.g. AXV-000001 (derived from id on create; never reused).
    public_id = Column(String, unique=True, index=True, nullable=True)

    legal_name = Column(String, nullable=False, index=True)  # Company Name (sort key)
    dba = Column(String, nullable=True)

    # Primary contact (denormalized; additional contacts live in subcontractor_contacts)
    primary_contact_name = Column(String, nullable=True)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)

    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True, index=True)
    zip = Column(String, nullable=True)
    website = Column(String, nullable=True)

    services_provided = Column(Text, nullable=True)      # free-text summary
    geographic_coverage = Column(Text, nullable=True)    # service area

    # Lifecycle + compliance (see status lists above)
    vendor_status = Column(String, nullable=False, default="invited", index=True)
    compliance_status = Column(String, nullable=False, default="unknown", index=True)

    # Manual override of the computed compliance state / hold (spec allows this)
    compliance_override = Column(String, nullable=True)   # e.g. "on_hold", "approved"
    override_reason = Column(Text, nullable=True)
    override_by = Column(String, nullable=True)           # actor email
    override_at = Column(DateTime(timezone=True), nullable=True)

    # Denormalized document quick-view (kept in sync by the compliance engine)
    w9_status = Column(String, nullable=False, default="missing")
    coi_status = Column(String, nullable=False, default="missing")
    coi_expiration_date = Column(Date, nullable=True)
    agreement_status = Column(String, nullable=False, default="missing")
    agreement_signed_date = Column(Date, nullable=True)
    agreement_renewal_date = Column(Date, nullable=True)

    last_contact_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Soft-archive (tombstone). "inactive" is a status, not a delete; this is for
    # rare true archival. Directory views filter on deleted_at IS NULL.
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    contacts = relationship("SubcontractorContact", back_populates="subcontractor", cascade="all, delete-orphan")
    services = relationship("SubcontractorService", back_populates="subcontractor", cascade="all, delete-orphan")
    documents = relationship("SubcontractorDocument", back_populates="subcontractor", cascade="all, delete-orphan")
    activities = relationship("SubcontractorActivity", back_populates="subcontractor", cascade="all, delete-orphan")
    notes = relationship("SubcontractorNote", back_populates="subcontractor", cascade="all, delete-orphan")

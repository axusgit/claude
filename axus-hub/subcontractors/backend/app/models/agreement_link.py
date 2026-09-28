"""Pointer to the Axus Subcontractor Agreement signing envelope in aesign.

The e-signature workflow (agreement versions, signer, signature, IP, timestamp,
sealed PDF, certificate of completion) is owned entirely by the aesign service —
this module does NOT reimplement signing. We store just enough to link a vendor
to their aesign envelope and track renewal locally: the envelope id, the agreement
version that was in force, and the 24-month renewal date. Each renewal creates a
new envelope/row so historical agreements are never overwritten (spec §AGREEMENT).
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.database import Base

AGREEMENT_STATUSES = ["sent", "completed", "declined", "voided"]


class AgreementLink(Base):
    __tablename__ = "agreement_links"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)

    envelope_id = Column(String, nullable=True, index=True)  # aesign envelope id
    agreement_version = Column(String, nullable=True)
    status = Column(String, nullable=False, default="sent", index=True)
    sha256 = Column(String, nullable=True)   # integrity hash of the sealed PDF (from aesign)

    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    signed_at = Column(DateTime(timezone=True), nullable=True)
    renewal_date = Column(Date, nullable=True)  # signed date + agreement_renewal_months

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

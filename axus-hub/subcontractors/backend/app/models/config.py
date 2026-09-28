"""Admin-configurable compliance rules (spec §ADMIN CONFIGURATION).

Single-row table (id == 1). Business rules are NOT hard-coded in application
logic — the engine reads them from here. Defaults match the spec:
  COI advance notice   = 30 days
  reminder interval    = 7 days
  agreement renewal    = 24 months
  agreement advance    = 30 days
Email templates, required-documents, and agreement-version config can be added
as JSON columns here later without a schema change to the rest of the module.
"""
from sqlalchemy import Column, Integer, Text, DateTime, String
from sqlalchemy.sql import func

from app.database import Base


class ComplianceConfig(Base):
    __tablename__ = "compliance_config"

    id = Column(Integer, primary_key=True)  # always 1
    coi_advance_notice_days = Column(Integer, nullable=False, default=30)
    reminder_interval_days = Column(Integer, nullable=False, default=7)
    agreement_renewal_months = Column(Integer, nullable=False, default=24)
    agreement_advance_notice_days = Column(Integer, nullable=False, default=30)
    # Comma-separated internal recipients for compliance alerts. Defaults to the
    # shared intake inbox info@ (John, Sept 2026), matching Support/eSign.
    notification_recipients = Column(Text, nullable=True, default="info@axustechnologies.com")
    # COI must name this entity as additional insured (per John, Sept 2026).
    # Shown to vendors on the COI upload step and checked during review.
    additional_insured_name = Column(String, nullable=True, default="Axus Technologies")
    additional_insured_address = Column(
        Text, nullable=True,
        default="13046 Racetrack Rd., Suite 255, Tampa, FL 33626",
    )
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

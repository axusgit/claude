"""Audit / activity trail for a subcontractor (spec §ACTIVITY, §AUDIT LOGGING).

Mirrors Support's TicketActivity: `actor` is the staff email (null for system
events), `action` a machine key, `detail` a human-readable line. For status
overrides and similar, previous/new values are captured for the audit record.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class SubcontractorActivity(Base):
    __tablename__ = "subcontractor_activities"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=True, index=True)
    actor = Column(String, nullable=True)   # staff email; null = system/automated
    action = Column(String, nullable=False, index=True)  # e.g. invited, document_uploaded, coi_approved
    detail = Column(Text, nullable=True)
    previous_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subcontractor = relationship("Subcontractor", back_populates="activities")

"""Internal-only notes on a subcontractor. Never visible to the subcontractor
(spec §NOTES) — the onboarding portal never queries this table."""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class SubcontractorNote(Base):
    __tablename__ = "subcontractor_notes"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)
    author = Column(String, nullable=True)   # staff email
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subcontractor = relationship("Subcontractor", back_populates="notes")

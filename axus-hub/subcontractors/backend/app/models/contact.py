"""Additional contacts for a subcontractor (beyond the primary on the record)."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class SubcontractorContact(Base):
    __tablename__ = "subcontractor_contacts"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    title = Column(String, nullable=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subcontractor = relationship("Subcontractor", back_populates="contacts")

"""Structured services a subcontractor provides (in addition to the free-text
summary on the subcontractor record), so the directory can filter by service."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class SubcontractorService(Base):
    __tablename__ = "subcontractor_services"

    id = Column(Integer, primary_key=True, index=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subcontractor = relationship("Subcontractor", back_populates="services")

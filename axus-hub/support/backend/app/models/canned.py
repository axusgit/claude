"""Canned responses — reusable saved replies staff can insert into a ticket reply.

Shared across all staff. Body may contain {{placeholders}} that the frontend fills
from the open ticket (e.g. {{name}}, {{ref}}, {{title}}, {{company}}, {{me}}).
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class CannedResponse(Base):
    __tablename__ = "canned_responses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

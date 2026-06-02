from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    # Optionally tie an attachment to a specific reply in the conversation thread.
    comment_id = Column(Integer, ForeignKey("ticket_comments.id"), nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)        # original filename as uploaded
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=False)           # bytes
    stored_name = Column(String, nullable=False)     # unique name on disk
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="attachments")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])

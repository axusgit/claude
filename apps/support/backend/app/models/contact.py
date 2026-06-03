from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Contact(Base):
    """A person who belongs to a customer company (e.g. Jim Smith @ Acme Corp).

    Distinct from a portal login: a contact is a directory record and need not
    have an account. Tickets can later reference the contact who reported them.
    """
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    title = Column(String, nullable=True)   # job title / role at the company
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    client = relationship("Client", foreign_keys=[client_id])

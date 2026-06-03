from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base


class Client(Base):
    """A Business / company that Axus provides services to."""
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, nullable=False, index=True)   # Business Name
    contact_name = Column(String, nullable=False, default="")   # legacy; people live in Contacts now
    email = Column(String, nullable=False, default="")          # legacy; used by email intake matching
    phone = Column(String)
    ext = Column(String)                                        # phone extension
    website = Column(String)
    address = Column(Text)                                      # exposed as "Location"
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def location(self):
        return self.address

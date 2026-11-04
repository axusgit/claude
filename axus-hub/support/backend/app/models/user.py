from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum, ForeignKey, Text
from sqlalchemy.sql import func
import enum
from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    technician = "technician"
    client = "client"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.technician, nullable=False)
    phone = Column(String, nullable=True)
    signature = Column(Text, nullable=True)        # staff reply signature (text)
    signature_logo = Column(Text, nullable=True)   # signature logo (resized data URL)
    is_active = Column(Boolean, default=True)
    # A "multi-user" account is a shared portal login used by several people (e.g. a
    # front-desk or shared-mailbox login). When such a user opens a ticket, the portal
    # requires a "Work Requested By" field so we know which person is actually asking.
    is_multi_user = Column(Boolean, server_default="false", nullable=False, default=False)
    # Set for client-portal users: ties the login to the company they belong to,
    # so the portal can scope them to their own tickets only.
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    # Provenance + link back to the source record when imported from Xcitium.
    source = Column(String, server_default="native", nullable=False)
    xcitium_user_id = Column(String, index=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Client password login (optional; alongside magic link). See password_policy.py.
    password_set_at = Column(DateTime(timezone=True), nullable=True)          # for 90-day expiry
    must_change_password = Column(Boolean, server_default="false", nullable=False, default=False)
    password_login_enabled = Column(Boolean, server_default="false", nullable=False, default=False)

from sqlalchemy import Column, Integer, String, Text, Enum, ForeignKey, DateTime, Float, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    waiting = "waiting"
    closed = "closed"


class TicketPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TicketType(str, enum.Enum):
    standard = "standard"   # < 8 hours
    sow = "sow"             # >= 8 hours / project work


class TicketOrigin(str, enum.Enum):
    """Where the ticket came from. The reporter_user_id still records *which* client
    person it's for; this records the channel/who originated it -- so a ticket an Axus
    tech opens proactively is distinguishable from one the client raised."""
    client_portal = "client_portal"   # client submitted it via the portal
    client_email = "client_email"     # arrived by email
    client_phone = "client_phone"     # phoned in, logged by a tech
    axus_tech = "axus_tech"           # Axus-initiated / proactive
    monitoring = "monitoring"         # raised from a monitoring alert


# Allowed origin values (stored as plain strings) and their display labels.
TICKET_ORIGINS = {
    "client_portal": "Client · Portal",
    "client_email": "Client · Email",
    "client_phone": "Client · Phone",
    "axus_tech": "Axus Tech",
    "monitoring": "Monitoring / Alert",
}


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    # Human-friendly reference shown to staff and clients, e.g. "AXUS-1001".
    reference = Column(String, unique=True, index=True, nullable=True)
    # Graph conversationId, for threading inbound email replies onto the ticket.
    email_conversation_id = Column(String, index=True, nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    category = Column(String, nullable=True)  # e.g. Hardware, Software, Network, Email
    status = Column(Enum(TicketStatus), default=TicketStatus.open, nullable=False)
    priority = Column(Enum(TicketPriority), default=TicketPriority.medium, nullable=False)
    ticket_type = Column(Enum(TicketType), default=TicketType.standard, nullable=False)
    # Where the ticket came from (see TicketOrigin). Stored as a plain string so the
    # option set can evolve without a DB enum migration. Null for pre-existing rows.
    origin = Column(String, nullable=True)

    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=True)       # service board / queue
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)   # legacy: email-intake reporter
    reporter_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # business user who reported it
    # If set, this ticket belongs to a project (another ticket of type sow).
    project_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    total_hours = Column(Float, default=0.0)
    invoiced = Column(Boolean, default=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    client = relationship("Client", foreign_keys=[client_id])
    reporter = relationship("User", foreign_keys=[reporter_user_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    time_entries = relationship("TimeEntry", back_populates="ticket")
    comments = relationship(
        "TicketComment",
        back_populates="ticket",
        order_by="TicketComment.created_at",
        cascade="all, delete-orphan",
    )
    activities = relationship(
        "TicketActivity",
        back_populates="ticket",
        order_by="TicketActivity.created_at",
        cascade="all, delete-orphan",
    )
    attachments = relationship(
        "Attachment",
        back_populates="ticket",
        order_by="Attachment.created_at",
        cascade="all, delete-orphan",
    )


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    hours = Column(Float, nullable=False)
    notes = Column(Text)
    logged_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="time_entries")
    user = relationship("User", foreign_keys=[user_id])


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    # Internal notes are staff-only; public replies are visible to the client.
    is_internal = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])


class TicketActivity(Base):
    __tablename__ = "ticket_activities"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    # Who performed the action; null for system-generated events.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)   # e.g. created, status_changed, assigned
    detail = Column(String, nullable=True)    # human-readable description of the change
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="activities")
    user = relationship("User", foreign_keys=[user_id])

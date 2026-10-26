from sqlalchemy import Column, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class TicketReminder(Base):
    """A follow-up task attached to a ticket (case) for a staff owner to do, e.g.
    "Email customer about the firewall quote".

    The owner defaults to the ticket's assignee and is emailed once when the
    reminder comes due. due_at is a timezone-naive wall-clock Eastern (ET) value,
    the same convention as Ticket.scheduled_date.
    """
    __tablename__ = "ticket_reminders"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    # The staff member responsible for acting on the reminder.
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note = Column(Text, nullable=False)
    due_at = Column(DateTime, nullable=False)          # wall-clock ET (naive)
    done = Column(Boolean, default=False, nullable=False)
    done_at = Column(DateTime(timezone=True), nullable=True)
    # Set once the due-date email has been sent, so the owner is reminded only once.
    notified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", foreign_keys=[ticket_id])
    owner = relationship("User", foreign_keys=[owner_id])
    created_by = relationship("User", foreign_keys=[created_by_id])

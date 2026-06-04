from sqlalchemy import Column, Integer, String, Float, Enum, ForeignKey, DateTime, Text, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class InvoiceStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"
    void = "void"


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoices = relationship("Invoice", back_populates="customer")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    number = Column(String, unique=True, index=True, nullable=True)  # INV-1001
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.draft, nullable=False)
    issue_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    total = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)

    customer = relationship("Customer", back_populates="invoices")
    line_items = relationship("InvoiceLineItem", back_populates="invoice", cascade="all, delete-orphan")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    description = Column(String, nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    amount = Column(Float, default=0.0)

    invoice = relationship("Invoice", back_populates="line_items")

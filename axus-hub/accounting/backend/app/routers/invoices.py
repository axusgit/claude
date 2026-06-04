from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
from pydantic import BaseModel

from axus_auth import get_identity
from app.database import get_db
from app.models.billing import Customer, Invoice, InvoiceLineItem, InvoiceStatus

router = APIRouter(prefix="/api", tags=["billing"])
NUMBER_BASE = 1000  # invoices start at INV-1001
auth = Depends(get_identity)


# ---------- Customers ----------

class CustomerIn(BaseModel):
    name: str
    email: Optional[str] = None


class CustomerOut(BaseModel):
    id: int
    name: str
    email: Optional[str]

    class Config:
        from_attributes = True


@router.get("/customers", response_model=List[CustomerOut])
def list_customers(db: Session = Depends(get_db), _=auth):
    return db.query(Customer).order_by(Customer.name).all()


@router.post("/customers", response_model=CustomerOut)
def create_customer(data: CustomerIn, db: Session = Depends(get_db), _=auth):
    c = Customer(**data.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


# ---------- Invoices ----------

class LineItemIn(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price: float = 0.0


class LineItemOut(LineItemIn):
    id: int
    amount: float

    class Config:
        from_attributes = True


class InvoiceIn(BaseModel):
    customer_id: int
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None
    line_items: List[LineItemIn] = []


class InvoiceOut(BaseModel):
    id: int
    number: Optional[str]
    customer_id: int
    status: str
    issue_date: Optional[date]
    due_date: Optional[date]
    total: float
    notes: Optional[str]
    paid_at: Optional[datetime]

    class Config:
        from_attributes = True


def _recalc(inv: Invoice):
    inv.total = round(sum(li.amount for li in inv.line_items), 2)


@router.get("/invoices", response_model=List[InvoiceOut])
def list_invoices(status: Optional[str] = None, customer_id: Optional[int] = None,
                  db: Session = Depends(get_db), _=auth):
    q = db.query(Invoice)
    if status:
        q = q.filter(Invoice.status == status)
    if customer_id:
        q = q.filter(Invoice.customer_id == customer_id)
    return q.order_by(Invoice.id.desc()).all()


@router.post("/invoices", response_model=InvoiceOut)
def create_invoice(data: InvoiceIn, db: Session = Depends(get_db), _=auth):
    if not db.query(Customer).filter(Customer.id == data.customer_id).first():
        raise HTTPException(status_code=404, detail="Customer not found")
    inv = Invoice(customer_id=data.customer_id, issue_date=data.issue_date,
                  due_date=data.due_date, notes=data.notes)
    for li in data.line_items:
        inv.line_items.append(InvoiceLineItem(
            description=li.description, quantity=li.quantity, unit_price=li.unit_price,
            amount=round(li.quantity * li.unit_price, 2)))
    _recalc(inv)
    db.add(inv)
    db.flush()
    inv.number = f"INV-{NUMBER_BASE + inv.id}"
    db.commit(); db.refresh(inv)
    return inv


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, db: Session = Depends(get_db), _=auth):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    out = InvoiceOut.model_validate(inv).model_dump()
    out["line_items"] = [LineItemOut.model_validate(li).model_dump() for li in inv.line_items]
    cust = db.query(Customer).filter(Customer.id == inv.customer_id).first()
    out["customer_name"] = cust.name if cust else None
    return out


class StatusIn(BaseModel):
    status: str  # draft | sent | paid | void


@router.put("/invoices/{invoice_id}/status", response_model=InvoiceOut)
def set_status(invoice_id: int, data: StatusIn, db: Session = Depends(get_db), _=auth):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if data.status not in InvoiceStatus.__members__:
        raise HTTPException(status_code=400, detail="Invalid status")
    inv.status = data.status
    if data.status == "sent" and not inv.issue_date:
        inv.issue_date = date.today()
    inv.paid_at = datetime.utcnow() if data.status == "paid" else None
    db.commit(); db.refresh(inv)
    return inv


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: int, db: Session = Depends(get_db), _=auth):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(inv); db.commit()
    return {"status": "deleted", "id": invoice_id}

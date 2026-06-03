from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import date, timedelta
import os

from app.database import engine, Base, get_db, SessionLocal
from app.routers import invoices
import app.models  # register models
from app.models.billing import Customer, Invoice, InvoiceLineItem

app = FastAPI(title="Axus Accounting", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|([a-z0-9-]+\.)*hub\.axustechnologies\.com)",
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
app.include_router(invoices.router)


@app.on_event("startup")
def init_db():
    # Greenfield app: create_all for now (move to Alembic before it holds real data).
    Base.metadata.create_all(bind=engine)
    _seed()


def _seed():
    db = SessionLocal()
    try:
        if db.query(Customer).count() > 0:
            return
        acme = Customer(name="Acme Corp", email="ap@acmecorp.com")
        globex = Customer(name="Globex Inc", email="billing@globex.com")
        db.add_all([acme, globex]); db.commit(); db.refresh(acme); db.refresh(globex)
        today = date.today()
        seed = [
            (acme.id, "paid",  [("Managed services - May", 1, 2500)], today - timedelta(days=20), today - timedelta(days=5)),
            (acme.id, "sent",  [("Managed services - June", 1, 2500), ("Onsite visit", 3, 150)], today - timedelta(days=2), today + timedelta(days=12)),
            (globex.id, "sent", [("Firewall replacement", 1, 1800)], today - timedelta(days=40), today - timedelta(days=10)),  # overdue
            (globex.id, "draft", [("Wi-Fi survey", 1, 900)], None, None),
        ]
        for cid, status, items, issued, due in seed:
            inv = Invoice(customer_id=cid, status=status, issue_date=issued, due_date=due)
            for desc, qty, price in items:
                inv.line_items.append(InvoiceLineItem(description=desc, quantity=qty, unit_price=price, amount=qty * price))
            inv.total = sum(li.amount for li in inv.line_items)
            db.add(inv); db.flush()
            inv.number = f"INV-{1000 + inv.id}"
        db.commit()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Axus Accounting"}


@app.get("/api/summary")
def summary(db: Session = Depends(get_db)):
    """KPI summary for the Hub command center (internal, no auth)."""
    open_count = db.query(Invoice).filter(Invoice.status.in_(["draft", "sent"])).count()
    outstanding = db.query(func.coalesce(func.sum(Invoice.total), 0.0)).filter(Invoice.status == "sent").scalar() or 0
    overdue = db.query(Invoice).filter(Invoice.status == "sent", Invoice.due_date.isnot(None),
                                       Invoice.due_date < date.today()).count()
    collected = db.query(func.coalesce(func.sum(Invoice.total), 0.0)).filter(Invoice.status == "paid").scalar() or 0
    money = lambda v: "$" + format(int(round(v)), ",")
    return {
        "app": "accounting",
        "kpis": [
            {"label": "Open invoices", "value": open_count, "tone": "accent"},
            {"label": "Outstanding", "value": money(outstanding), "tone": "danger" if outstanding else ""},
            {"label": "Overdue", "value": overdue, "tone": "danger" if overdue else ""},
            {"label": "Collected", "value": money(collected), "tone": "good"},
        ],
        "footnote": f"{db.query(Customer).count()} customers",
    }


frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
static_path = os.path.join(frontend_path, "static")
if os.path.isdir(frontend_path):
    if os.path.isdir(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        return FileResponse(os.path.join(frontend_path, "index.html"))

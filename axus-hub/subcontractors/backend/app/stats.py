"""Dashboard / command-center metrics computed from the denormalized compliance
quick-view columns on `subcontractors` (kept in sync by the compliance engine)."""
from datetime import date, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.subcontractor import Subcontractor


def _active(db: Session):
    return db.query(Subcontractor).filter(Subcontractor.deleted_at.is_(None))


def compute_stats(db: Session) -> dict:
    today = date.today()
    horizon = today + timedelta(days=30)
    return {
        "total_active": _active(db).filter(Subcontractor.vendor_status != "inactive").count(),
        "approved": _active(db).filter(Subcontractor.vendor_status == "approved").count(),
        "pending_onboarding": _active(db).filter(
            Subcontractor.vendor_status.in_(["invited", "onboarding"])
        ).count(),
        "pending_review": _active(db).filter(Subcontractor.vendor_status == "pending_review").count(),
        "missing_w9": _active(db).filter(Subcontractor.w9_status == "missing").count(),
        "coi_expiring_30": _active(db).filter(
            Subcontractor.coi_expiration_date.isnot(None),
            Subcontractor.coi_expiration_date >= today,
            Subcontractor.coi_expiration_date <= horizon,
        ).count(),
        "coi_expired": _active(db).filter(
            or_(
                Subcontractor.coi_status == "expired",
                Subcontractor.coi_expiration_date < today,
            )
        ).count(),
        "agreements_due_30": _active(db).filter(
            Subcontractor.agreement_renewal_date.isnot(None),
            Subcontractor.agreement_renewal_date >= today,
            Subcontractor.agreement_renewal_date <= horizon,
        ).count(),
        "agreements_overdue": _active(db).filter(
            Subcontractor.agreement_renewal_date.isnot(None),
            Subcontractor.agreement_renewal_date < today,
        ).count(),
        "non_compliant": _active(db).filter(
            or_(
                Subcontractor.compliance_status == "non_compliant",
                Subcontractor.vendor_status == "non_compliant",
            )
        ).count(),
    }


def build_summary(db: Session) -> dict:
    """KPI feed for the Hub command center (see hub /api/dashboard)."""
    s = compute_stats(db)
    kpis = [
        {"label": "Active vendors", "value": s["total_active"], "tone": "neutral"},
        {"label": "Pending review", "value": s["pending_review"], "tone": "warn" if s["pending_review"] else "neutral"},
        {"label": "COIs expiring 30d", "value": s["coi_expiring_30"], "tone": "warn" if s["coi_expiring_30"] else "neutral"},
        {"label": "Non-compliant", "value": s["non_compliant"], "tone": "bad" if s["non_compliant"] else "good"},
    ]
    return {"app": "subcontractors", "kpis": kpis, "footnote": "Subcontractor Management"}

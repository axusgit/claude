"""Shared domain logic used across the invite, portal, review, and engine layers:
portal links, requirement checks, document versioning, and the compliance
recomputation that keeps the denormalized quick-view columns + statuses correct.
"""
import os
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.subcontractor import Subcontractor
from app.models.document import SubcontractorDocument
from app.models.document_request import DocumentRequest
from app.models.agreement_link import AgreementLink
from app.config_util import get_config

PORTAL_URL = os.getenv("PORTAL_URL", "https://sub.axustechnologies.com/onboarding")

# Company fields required before onboarding can be submitted for review.
REQUIRED_COMPANY_FIELDS = [
    "legal_name", "email", "address", "city", "state", "zip",
    "primary_contact_name", "phone",
]


def portal_link(raw_token: str) -> str:
    return f"{PORTAL_URL}/{raw_token}"


def company_complete(sub: Subcontractor) -> bool:
    return all(getattr(sub, f) for f in REQUIRED_COMPANY_FIELDS)


def latest_doc(db: Session, sub_id: int, doc_type: str) -> SubcontractorDocument | None:
    return (
        db.query(SubcontractorDocument)
        .filter(SubcontractorDocument.subcontractor_id == sub_id,
                SubcontractorDocument.doc_type == doc_type)
        .order_by(SubcontractorDocument.version.desc())
        .first()
    )


def next_version(db: Session, sub_id: int, doc_type: str) -> int:
    m = (
        db.query(func.max(SubcontractorDocument.version))
        .filter(SubcontractorDocument.subcontractor_id == sub_id,
                SubcontractorDocument.doc_type == doc_type)
        .scalar()
    )
    return (m or 0) + 1


def latest_agreement(db: Session, sub_id: int) -> AgreementLink | None:
    return (
        db.query(AgreementLink)
        .filter(AgreementLink.subcontractor_id == sub_id)
        .order_by(AgreementLink.id.desc())
        .first()
    )


def agreement_signed_by_sub(db: Session, sub: Subcontractor) -> bool:
    """True once the SUBCONTRACTOR has signed the agreement (first signature),
    whether or not Axus has counter-signed yet. Informational only — the W-9/COI
    request is decoupled from signing (it goes out once at company creation)."""
    ag = latest_agreement(db, sub.id)
    return bool(ag and ag.status in ("partially_signed", "completed"))


def outstanding_requirements(db: Session, sub: Subcontractor) -> list[str]:
    """What the vendor still needs to PROVIDE (for the creation request email, the
    portal progress view, and submit gating). A document counts as provided once it's
    uploaded (received/pending_review/approved/current); only missing or rejected
    items are outstanding. Approval happens in Axus review, after submission — so
    this is deliberately provided-based, not approval-based.

    The W-9 and COI are requested once, when the company is created (the Subcontractor
    Agreement is handled separately by staff and is NOT part of this list)."""
    items = []
    if not company_complete(sub):
        items.append("Company information")
    if sub.w9_status in ("missing", "rejected"):
        items.append("W-9")
    if sub.coi_status in ("missing", "rejected", "expired"):
        items.append("Certificate of Insurance (COI)")
    return items


def get_or_create_onboarding_request(db: Session, sub: Subcontractor) -> DocumentRequest:
    req = (
        db.query(DocumentRequest)
        .filter(DocumentRequest.subcontractor_id == sub.id,
                DocumentRequest.request_type == "onboarding",
                DocumentRequest.status.in_(["open", "awaiting_review"]))
        .first()
    )
    if req is None:
        req = DocumentRequest(subcontractor_id=sub.id, request_type="onboarding", status="open")
        db.add(req)
        db.flush()
    return req


def _as_date(d) -> date | None:
    if d is None:
        return None
    return d if isinstance(d, date) else d.date()


def recompute_compliance(db: Session, sub: Subcontractor) -> None:
    """Refresh the denormalized COI status/expiry + rolled-up compliance_status
    from the authoritative document/agreement rows. Honors a manual override.
    Does not commit."""
    cfg = get_config(db)
    today = date.today()
    notice = timedelta(days=cfg.coi_advance_notice_days)

    # COI: derive status from the latest approved/known COI expiration.
    coi = latest_doc(db, sub.id, "coi")
    if coi and coi.status == "approved" and coi.expiration_date:
        sub.coi_expiration_date = coi.expiration_date
        exp = _as_date(coi.expiration_date)
        if exp < today:
            sub.coi_status = "expired"
        elif exp <= today + notice:
            sub.coi_status = "expiring_soon"
        else:
            sub.coi_status = "current"
    elif coi and coi.status in ("pending_review", "received"):
        sub.coi_status = "pending_review"
    elif coi and coi.status == "rejected":
        sub.coi_status = "rejected"
    else:
        sub.coi_status = "missing"

    # W-9
    w9 = latest_doc(db, sub.id, "w9")
    sub.w9_status = w9.status if w9 else "missing"

    # Agreement (mirrors agreement_links; envelope owned by aesign)
    ag = latest_agreement(db, sub.id)
    if ag and ag.status == "completed":
        sub.agreement_signed_date = _as_date(ag.signed_at) or sub.agreement_signed_date
        sub.agreement_renewal_date = ag.renewal_date or sub.agreement_renewal_date
        rd = sub.agreement_renewal_date
        if rd and rd < today:
            sub.agreement_status = "expired"
        elif rd and rd <= today + timedelta(days=cfg.agreement_advance_notice_days):
            sub.agreement_status = "renewal_due"
        else:
            sub.agreement_status = "current"
    elif ag and ag.status in ("draft", "sent", "partially_signed"):
        # draft = created in eSign, sent = out for signature, partially_signed =
        # subcontractor has signed and we're awaiting the Axus counter-signature.
        sub.agreement_status = "pending_signature"
    else:
        sub.agreement_status = "missing"

    # Rolled-up compliance status (respect a manual override if set).
    if sub.compliance_override:
        sub.compliance_status = sub.compliance_override
        return

    approved_w9 = sub.w9_status == "approved"
    coi_ok = sub.coi_status in ("current", "expiring_soon")
    ag_ok = sub.agreement_status in ("current", "renewal_due")
    if sub.coi_status == "expired" or sub.agreement_status == "expired" or \
            (approved_w9 and (sub.coi_status == "rejected")):
        sub.compliance_status = "non_compliant"
    elif approved_w9 and coi_ok and ag_ok:
        sub.compliance_status = "expiring_soon" if (
            sub.coi_status == "expiring_soon" or sub.agreement_status == "renewal_due"
        ) else "compliant"
    elif sub.vendor_status in ("invited", "onboarding", "pending_review"):
        sub.compliance_status = "pending"
    else:
        sub.compliance_status = "unknown"

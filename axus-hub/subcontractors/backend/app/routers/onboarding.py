"""Public onboarding portal API (no Axus login).

Every route is scoped to the single subcontractor the token resolves to, so one
vendor's token can never read or change another's data. Traefik routes these paths
(/api/onboarding/*) through geo-gate only (no staff SSO); the token is the
credential. Internal-only fields (notes, other vendors, audit internals) are never
returned here.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.database import get_db
from app.tokens import resolve_token
from app.activity import log_activity
from app.config_util import get_config
from app import notify, services, storage
from app.models.document import SubcontractorDocument
from app.schemas import OnboardingCompanyUpdate

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

_COMPANY_FIELDS = [
    "legal_name", "dba", "primary_contact_name", "email", "phone", "address",
    "city", "state", "zip", "website", "services_provided", "geographic_coverage",
]


def _resolve(db: Session, token: str):
    sub = resolve_token(db, token)
    if sub is None:
        raise HTTPException(status_code=404, detail="This onboarding link is invalid or has expired.")
    return sub


def _state(db: Session, sub) -> dict:
    cfg = get_config(db)
    return {
        "public_id": sub.public_id,
        "company": {f: getattr(sub, f) for f in _COMPANY_FIELDS},
        "progress": {
            "company_complete": services.company_complete(sub),
            "w9_status": sub.w9_status,
            "coi_status": sub.coi_status,
            "agreement_status": sub.agreement_status,
            "submitted": sub.vendor_status in ("pending_review", "approved"),
        },
        "outstanding": services.outstanding_requirements(db, sub),
        "coi_additional_insured": {
            "name": cfg.additional_insured_name,
            "address": cfg.additional_insured_address,
        },
    }


@router.get("/{token}")
def get_state(token: str, db: Session = Depends(get_db)):
    sub = _resolve(db, token)
    db.commit()  # persist last_used_at from resolve_token
    return _state(db, sub)


@router.patch("/{token}/company")
def update_company(token: str, payload: OnboardingCompanyUpdate, db: Session = Depends(get_db)):
    sub = _resolve(db, token)
    changes = payload.model_dump(exclude_unset=True)
    for field, val in changes.items():
        if field in _COMPANY_FIELDS:
            setattr(sub, field, val)
    if sub.vendor_status == "invited":
        sub.vendor_status = "onboarding"
    log_activity(db, sub.id, None, "vendor_updated_info", detail="Vendor updated company information")
    services.recompute_compliance(db, sub)
    db.commit()
    return _state(db, sub)


@router.post("/{token}/documents")
async def upload_document(
    token: str,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    sub = _resolve(db, token)
    if doc_type not in ("w9", "coi"):
        raise HTTPException(status_code=400, detail="doc_type must be 'w9' or 'coi'")
    if not storage.is_allowed(file.filename):
        allowed = ", ".join(sorted(e[1:] for e in storage.ALLOWED_EXTS))
        raise HTTPException(status_code=400, detail=f"File type not allowed. Accepted: {allowed}")
    content = await file.read()
    if len(content) > storage.MAX_ATTACHMENT_BYTES:
        mb = storage.MAX_ATTACHMENT_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File exceeds the {mb} MB limit")
    stored_name = storage.save_encrypted(content)
    doc = SubcontractorDocument(
        subcontractor_id=sub.id, doc_type=doc_type,
        version=services.next_version(db, sub.id, doc_type),
        status="pending_review", stored_name=stored_name,
        original_filename=file.filename, content_type=file.content_type,
        size=len(content), uploaded_by="subcontractor",
    )
    db.add(doc)
    db.flush()  # make the new row visible to recompute (session autoflush is off)
    if sub.vendor_status == "invited":
        sub.vendor_status = "onboarding"
    log_activity(db, sub.id, None, "document_uploaded",
                 detail=f"{doc_type.upper()} uploaded by vendor (v{doc.version})")
    services.recompute_compliance(db, sub)
    db.commit()
    return _state(db, sub)


@router.post("/{token}/submit")
def submit_for_review(token: str, db: Session = Depends(get_db)):
    sub = _resolve(db, token)
    services.recompute_compliance(db, sub)  # reflect latest docs/agreement before gating
    outstanding = services.outstanding_requirements(db, sub)
    if outstanding:
        raise HTTPException(status_code=400,
                            detail={"message": "Onboarding is not complete.", "outstanding": outstanding})
    sub.vendor_status = "pending_review"
    now = datetime.now(timezone.utc)
    for req in _open_onboarding(db, sub.id):
        req.status = "awaiting_review"
    log_activity(db, sub.id, None, "submitted_for_review", detail="Vendor submitted onboarding for review")
    notify.send_internal_alert(
        db, subject=f"Subcontractor ready for review — {sub.legal_name}",
        title="A subcontractor has submitted onboarding for review",
        intro=f"{sub.legal_name} ({sub.public_id}) has completed onboarding and is awaiting Axus review.",
        subcontractor_id=sub.id,
    )
    db.commit()
    return _state(db, sub)


def _open_onboarding(db: Session, sub_id: int):
    from app.models.document_request import DocumentRequest
    return db.query(DocumentRequest).filter(
        DocumentRequest.subcontractor_id == sub_id,
        DocumentRequest.request_type == "onboarding",
        DocumentRequest.status.in_(["open", "awaiting_review"]),
    ).all()

"""Axus review/approval workflow, manual compliance override, and internal notes."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    AppUser, get_current_user, require_staff, require_permission,
    P_APPROVE, P_REVIEW_DOCS, P_OVERRIDE, P_DEACTIVATE,
)
from app.activity import log_activity
from app.tokens import issue_token
from app import notify, services
from app.models.document_request import DocumentRequest
from app.models.note import SubcontractorNote
from app.schemas import VendorReview
from app.routers.subcontractors import _get_or_404

router = APIRouter(prefix="/api/subcontractors", tags=["review"])

_ACTION_PERM = {
    "approve": P_APPROVE, "reject": P_APPROVE,
    "request_correction": P_REVIEW_DOCS,
    "hold": P_OVERRIDE, "inactive": P_DEACTIVATE,
}


def _cancel_open_requests(db: Session, sub_id: int):
    now = datetime.now(timezone.utc)
    for req in db.query(DocumentRequest).filter(
        DocumentRequest.subcontractor_id == sub_id,
        DocumentRequest.status.in_(["open", "awaiting_review"]),
    ).all():
        req.status = "cancelled"
        req.cancelled_at = now


@router.post("/{sub_id}/review")
def review_vendor(sub_id: int, payload: VendorReview, db: Session = Depends(get_db),
                  user: AppUser = Depends(get_current_user)):
    action = payload.action
    perm = _ACTION_PERM.get(action)
    if perm is None:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    if not user.can(perm):
        raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")

    sub = _get_or_404(db, sub_id)
    prev = sub.vendor_status
    now = datetime.now(timezone.utc)

    if action == "approve":
        sub.vendor_status = "approved"
        for req in db.query(DocumentRequest).filter(
            DocumentRequest.subcontractor_id == sub.id,
            DocumentRequest.request_type == "onboarding",
            DocumentRequest.status.in_(["open", "awaiting_review"]),
        ).all():
            req.status = "completed"
            req.completed_at = now
        log_activity(db, sub.id, user.email, "vendor_approved",
                     detail="Subcontractor approved", previous_value=prev, new_value="approved")
        notify.send(
            db, sub.id, sub.email, "onboarding_completed",
            subject="You're approved — welcome aboard",
            title="Your Axus subcontractor onboarding is approved",
            intro=(f"Thanks {sub.primary_contact_name or sub.legal_name} — your onboarding "
                   "with Axus Technologies is complete and approved. We'll be in touch with work."),
        )
    elif action == "request_correction":
        sub.vendor_status = "missing_documents"
        raw = issue_token(db, sub.id)
        log_activity(db, sub.id, user.email, "correction_requested",
                     detail=payload.reason or "Correction requested", previous_value=prev,
                     new_value="missing_documents")
        notify.send(
            db, sub.id, sub.email, "correction_requested",
            subject="Action needed on your Axus onboarding",
            title="A correction is needed to complete your onboarding",
            intro=f"Please review and update the following: {payload.reason or 'see the portal'}.",
            cta_text="Open onboarding", cta_url=services.portal_link(raw),
        )
    elif action == "reject":
        sub.vendor_status = "inactive"
        _cancel_open_requests(db, sub.id)
        log_activity(db, sub.id, user.email, "vendor_rejected",
                     detail=payload.reason or "Subcontractor rejected", previous_value=prev,
                     new_value="inactive")
    elif action == "hold":
        sub.compliance_override = "on_hold"
        sub.override_reason = payload.reason
        sub.override_by = user.email
        sub.override_at = now
        sub.vendor_status = "on_hold"
        log_activity(db, sub.id, user.email, "vendor_held",
                     detail=payload.reason or "Placed on hold", previous_value=prev, new_value="on_hold")
    elif action == "inactive":
        sub.vendor_status = "inactive"
        _cancel_open_requests(db, sub.id)
        log_activity(db, sub.id, user.email, "vendor_deactivated",
                     detail="Marked inactive; compliance reminders stopped",
                     previous_value=prev, new_value="inactive")

    services.recompute_compliance(db, sub)
    db.commit()
    return {"vendor_status": sub.vendor_status, "compliance_status": sub.compliance_status}


class OverrideIn(BaseModel):
    status: str | None = None   # None clears the override
    reason: str | None = None


@router.post("/{sub_id}/override")
def override_compliance(sub_id: int, payload: OverrideIn, db: Session = Depends(get_db),
                        user: AppUser = Depends(require_permission(P_OVERRIDE))):
    sub = _get_or_404(db, sub_id)
    prev = sub.compliance_override or sub.compliance_status
    sub.compliance_override = payload.status
    sub.override_reason = payload.reason
    sub.override_by = user.email
    sub.override_at = datetime.now(timezone.utc)
    log_activity(db, sub.id, user.email, "status_overridden",
                 detail=payload.reason or "Compliance status overridden",
                 previous_value=str(prev), new_value=str(payload.status))
    services.recompute_compliance(db, sub)
    db.commit()
    return {"compliance_status": sub.compliance_status, "override": sub.compliance_override}


class NoteIn(BaseModel):
    body: str


@router.get("/{sub_id}/notes")
def list_notes(sub_id: int, db: Session = Depends(get_db), _: AppUser = Depends(require_staff)):
    _get_or_404(db, sub_id)
    notes = db.query(SubcontractorNote).filter(
        SubcontractorNote.subcontractor_id == sub_id
    ).order_by(SubcontractorNote.id.desc()).all()
    return [{"id": n.id, "author": n.author, "body": n.body, "created_at": n.created_at} for n in notes]


@router.post("/{sub_id}/notes")
def add_note(sub_id: int, payload: NoteIn, db: Session = Depends(get_db),
             user: AppUser = Depends(require_staff)):
    _get_or_404(db, sub_id)
    n = SubcontractorNote(subcontractor_id=sub_id, author=user.email, body=payload.body)
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"id": n.id, "author": n.author, "body": n.body, "created_at": n.created_at}

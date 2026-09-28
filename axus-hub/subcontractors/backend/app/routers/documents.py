"""Staff document access & review.

Downloads decrypt on the fly and are permission-gated: W-9 requires the distinct
`access_w9_documents` permission (tax data), other docs require review access.
Document downloads of the W-9 are audited. Approving/rejecting a document updates
compliance and, on rejection, notifies the vendor with a fresh upload link.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    AppUser, get_current_user, require_staff, require_permission,
    P_VIEW_W9, P_REVIEW_DOCS,
)
from app.activity import log_activity
from app.tokens import issue_token
from app import notify, services, storage
from app.models.document import SubcontractorDocument
from app.schemas import DocumentReview
from app.routers.subcontractors import _get_or_404

router = APIRouter(prefix="/api/subcontractors", tags=["documents"])


@router.get("/{sub_id}/documents")
def list_documents(sub_id: int, db: Session = Depends(get_db), _: AppUser = Depends(require_staff)):
    _get_or_404(db, sub_id)
    docs = (
        db.query(SubcontractorDocument)
        .filter(SubcontractorDocument.subcontractor_id == sub_id)
        .order_by(SubcontractorDocument.doc_type, SubcontractorDocument.version.desc())
        .all()
    )
    return [
        {
            "id": d.id, "doc_type": d.doc_type, "version": d.version, "status": d.status,
            "effective_date": d.effective_date, "expiration_date": d.expiration_date,
            "original_filename": d.original_filename, "uploaded_by": d.uploaded_by,
            "uploaded_at": d.uploaded_at, "reviewed_by": d.reviewed_by,
            "reviewed_at": d.reviewed_at, "rejection_reason": d.rejection_reason,
        }
        for d in docs
    ]


@router.get("/{sub_id}/documents/{doc_id}/download")
def download_document(sub_id: int, doc_id: int, db: Session = Depends(get_db),
                      user: AppUser = Depends(get_current_user)):
    doc = _get_doc(db, sub_id, doc_id)
    # W-9 needs the sensitive-document permission; others need review access.
    needed = P_VIEW_W9 if doc.doc_type == "w9" else P_REVIEW_DOCS
    if not user.can(needed):
        raise HTTPException(status_code=403, detail=f"Missing permission: {needed}")
    try:
        content = storage.load_decrypted(doc.stored_name)
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="File is no longer available")
    if doc.doc_type == "w9":
        log_activity(db, sub_id, user.email, "w9_viewed",
                     detail=f"W-9 (v{doc.version}) downloaded")
        db.commit()
    filename = doc.original_filename or f"{doc.doc_type}.bin"
    return Response(
        content=content,
        media_type=doc.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{sub_id}/documents/{doc_id}/review")
def review_document(sub_id: int, doc_id: int, payload: DocumentReview,
                    db: Session = Depends(get_db),
                    user: AppUser = Depends(require_permission(P_REVIEW_DOCS))):
    sub = _get_or_404(db, sub_id)
    doc = _get_doc(db, sub_id, doc_id)
    now = datetime.now(timezone.utc)
    doc.reviewed_by = user.email
    doc.reviewed_at = now

    if payload.action == "approve":
        if doc.doc_type == "coi":
            if not payload.expiration_date:
                raise HTTPException(status_code=400, detail="COI approval requires an expiration_date")
            doc.effective_date = payload.effective_date
            doc.expiration_date = payload.expiration_date
        doc.status = "approved"
        doc.rejection_reason = None
        log_activity(db, sub.id, user.email, f"{doc.doc_type}_approved",
                     detail=f"{doc.doc_type.upper()} (v{doc.version}) approved")
        # Approving a replacement completes the matching renewal request.
        _complete_requests(db, sub.id, "coi_renewal" if doc.doc_type == "coi" else None)
    elif payload.action == "reject":
        doc.status = "rejected"
        doc.rejection_reason = payload.reason
        log_activity(db, sub.id, user.email, f"{doc.doc_type}_rejected",
                     detail=f"{doc.doc_type.upper()} (v{doc.version}) rejected: {payload.reason or ''}")
        raw = issue_token(db, sub.id)
        notify.send(
            db, sub.id, sub.email, "document_rejected",
            subject=f"Action needed — your {doc.doc_type.upper()} was not accepted",
            title=f"Your {doc.doc_type.upper()} needs a correction",
            intro=(f"Thanks for your submission. We couldn't accept your "
                   f"{doc.doc_type.upper()}. Reason: {payload.reason or 'see notes'}. "
                   "Please upload a corrected document using the link below."),
            cta_text="Upload corrected document", cta_url=services.portal_link(raw),
        )
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    services.recompute_compliance(db, sub)
    db.commit()
    return {"doc_status": doc.status, "compliance_status": sub.compliance_status,
            "coi_status": sub.coi_status, "w9_status": sub.w9_status}


# ----- helpers -----

def _get_doc(db: Session, sub_id: int, doc_id: int) -> SubcontractorDocument:
    doc = db.query(SubcontractorDocument).filter(
        SubcontractorDocument.id == doc_id,
        SubcontractorDocument.subcontractor_id == sub_id,
    ).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _complete_requests(db: Session, sub_id: int, request_type: str | None):
    if not request_type:
        return
    from app.models.document_request import DocumentRequest
    now = datetime.now(timezone.utc)
    for req in db.query(DocumentRequest).filter(
        DocumentRequest.subcontractor_id == sub_id,
        DocumentRequest.request_type == request_type,
        DocumentRequest.status.in_(["open", "awaiting_review"]),
    ).all():
        req.status = "completed"
        req.completed_at = now

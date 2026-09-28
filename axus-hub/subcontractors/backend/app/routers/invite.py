"""Staff actions: send / resend / cancel an onboarding invitation."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import AppUser, require_permission, P_INVITE
from app.activity import log_activity
from app.config_util import get_config
from app.tokens import issue_token
from app import notify, services
from app.models.onboarding_token import OnboardingToken
from app.routers.subcontractors import _get_or_404

router = APIRouter(prefix="/api/subcontractors", tags=["invite"])


def _do_invite(db: Session, sub, actor: str, resend: bool) -> dict:
    raw = issue_token(db, sub.id)
    link = services.portal_link(raw)
    req = services.get_or_create_onboarding_request(db, sub)
    cfg = get_config(db)
    now = datetime.now(timezone.utc)
    sub.vendor_status = "invited"
    sub.last_contact_at = now
    outstanding = services.outstanding_requirements(db, sub)
    sent = notify.send(
        db, sub.id, sub.email, "onboarding_invite",
        subject="Axus Technologies — Subcontractor Onboarding",
        title="Complete your Axus subcontractor onboarding",
        intro=(f"Hi {sub.primary_contact_name or sub.legal_name}, please complete your "
               "onboarding with Axus Technologies — it only takes a few minutes. "
               "Your Certificate of Insurance should name Axus Technologies as an "
               "additional insured (13046 Racetrack Rd., Suite 255, Tampa, FL 33626)."),
        lines=outstanding or None,
        cta_text="Start onboarding", cta_url=link, request_id=req.id,
    )
    if req.first_notification_at is None:
        req.first_notification_at = now
    req.last_notification_at = now
    req.next_notification_at = now + timedelta(days=cfg.reminder_interval_days)
    req.reminder_count = (req.reminder_count or 0) + 1
    log_activity(db, sub.id, actor,
                 "invitation_resent" if resend else "invitation_sent",
                 detail=f"Onboarding invitation {'re' if resend else ''}sent to {sub.email}")
    db.commit()
    return {"status": sub.vendor_status, "link": link, "emailed": sent}


@router.post("/{sub_id}/invite")
def send_invite(sub_id: int, db: Session = Depends(get_db),
                user: AppUser = Depends(require_permission(P_INVITE))):
    return _do_invite(db, _get_or_404(db, sub_id), user.email, resend=False)


@router.post("/{sub_id}/invite/resend")
def resend_invite(sub_id: int, db: Session = Depends(get_db),
                  user: AppUser = Depends(require_permission(P_INVITE))):
    return _do_invite(db, _get_or_404(db, sub_id), user.email, resend=True)


@router.post("/{sub_id}/invite/cancel")
def cancel_invite(sub_id: int, db: Session = Depends(get_db),
                  user: AppUser = Depends(require_permission(P_INVITE))):
    sub = _get_or_404(db, sub_id)
    now = datetime.now(timezone.utc)
    db.query(OnboardingToken).filter(
        OnboardingToken.subcontractor_id == sub.id,
        OnboardingToken.revoked_at.is_(None),
    ).update({OnboardingToken.revoked_at: now})
    # Stop the onboarding reminder cadence.
    for req in sub_open_requests(db, sub.id, "onboarding"):
        req.status = "cancelled"
        req.cancelled_at = now
    log_activity(db, sub.id, user.email, "invitation_cancelled",
                 detail="Onboarding invitation cancelled; reminders stopped")
    db.commit()
    return {"status": sub.vendor_status, "cancelled": True}


def sub_open_requests(db: Session, sub_id: int, request_type: str):
    from app.models.document_request import DocumentRequest
    return db.query(DocumentRequest).filter(
        DocumentRequest.subcontractor_id == sub_id,
        DocumentRequest.request_type == request_type,
        DocumentRequest.status.in_(["open", "awaiting_review"]),
    ).all()

"""Agreement e-signature: send via aesign + receive the completion webhook.

- POST /api/subcontractors/{id}/agreement/send  (staff, P_MANAGE_AGREEMENTS):
  asks aesign to generate + send the Subcontractor Agreement, records an
  AgreementLink(status="sent"), returns the signing URL.
- POST /api/aesign/webhook  (server-to-server from aesign, bearer-token gated):
  marks the agreement completed, sets the 24-month renewal date, recomputes
  compliance, and completes any open agreement_renewal request.
"""
import hmac
import os
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import AppUser, require_permission, P_MANAGE_AGREEMENTS
from app.activity import log_activity
from app.config_util import get_config
from app import aesign, services
from app.models.agreement_link import AgreementLink
from app.routers.subcontractors import _get_or_404

router = APIRouter(tags=["agreements"])
AESIGN_TOKEN = os.getenv("AESIGN_EXTERNAL_API_TOKEN", "")


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    from calendar import monthrange
    return date(y, m, min(d.day, monthrange(y, m)[1]))


@router.post("/api/subcontractors/{sub_id}/agreement/send")
def send_agreement(sub_id: int, db: Session = Depends(get_db),
                   user: AppUser = Depends(require_permission(P_MANAGE_AGREEMENTS))):
    sub = _get_or_404(db, sub_id)
    if not aesign.is_configured():
        raise HTTPException(status_code=503, detail="aesign integration is not configured")
    try:
        env = aesign.create_agreement_envelope(sub)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"aesign error: {e}")
    cfg = get_config(db)
    link = AgreementLink(
        subcontractor_id=sub.id, envelope_id=env["envelope_id"],
        agreement_version=cfg_version(cfg), status="sent",
    )
    db.add(link)
    sub.agreement_status = "pending_signature"
    log_activity(db, sub.id, user.email, "agreement_sent",
                 detail=f"Subcontractor Agreement sent for signature (envelope {env['envelope_id']})")
    db.commit()
    return {"envelope_id": env["envelope_id"], "sign_url": env.get("sign_url"),
            "status": "sent"}


def cfg_version(cfg) -> str:
    # Placeholder: the active agreement version label. Once the aesign template is
    # registered this can come from config; for now a constant.
    return os.getenv("AGREEMENT_VERSION", "v1.0")


class AesignCallback(BaseModel):
    envelopeId: str | None = None
    envelope_id: str | None = None
    status: str = "completed"
    sha256: str | None = None
    signedAt: str | None = None
    signer: dict | None = None


@router.post("/api/aesign/webhook")
def aesign_webhook(payload: AesignCallback, request: Request, db: Session = Depends(get_db)):
    # server-to-server: require the shared bearer token (constant-time compare)
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not AESIGN_TOKEN or not hmac.compare_digest(token, AESIGN_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")

    env_id = payload.envelopeId or payload.envelope_id
    if not env_id:
        raise HTTPException(status_code=400, detail="missing envelope id")
    link = db.query(AgreementLink).filter(AgreementLink.envelope_id == env_id).first()
    if link is None:
        raise HTTPException(status_code=404, detail="unknown envelope")

    sub = _get_or_404(db, link.subcontractor_id)
    now = datetime.now(timezone.utc)
    if payload.status == "completed":
        cfg = get_config(db)
        signed = _parse_dt(payload.signedAt) or now
        link.status = "completed"
        link.signed_at = signed
        link.sha256 = payload.sha256
        link.renewal_date = _add_months(signed.date(), cfg.agreement_renewal_months)
        log_activity(db, sub.id, None, "agreement_signed",
                     detail=f"Subcontractor Agreement signed (envelope {env_id})")
        # complete any open agreement_renewal request
        from app.models.document_request import DocumentRequest
        for req in db.query(DocumentRequest).filter(
            DocumentRequest.subcontractor_id == sub.id,
            DocumentRequest.request_type == "agreement_renewal",
            DocumentRequest.status.in_(["open", "awaiting_review"]),
        ).all():
            req.status = "completed"
            req.completed_at = now
    else:
        link.status = payload.status
        log_activity(db, sub.id, None, "agreement_" + payload.status,
                     detail=f"Agreement envelope {env_id} status: {payload.status}")

    services.recompute_compliance(db, sub)
    db.commit()
    return {"ok": True, "agreement_status": sub.agreement_status}


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None

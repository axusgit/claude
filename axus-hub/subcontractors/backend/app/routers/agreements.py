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
from app import aesign, services, storage
from app.models.agreement_link import AgreementLink
from app.models.document import SubcontractorDocument
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
    if sub.vendor_status == "approved":
        raise HTTPException(
            status_code=409,
            detail="This company is already approved — no need to send another agreement.")
    if not aesign.is_configured():
        raise HTTPException(status_code=503, detail="aesign integration is not configured")
    # Inverted flow: the agreement is sent FIRST (before the W-9 and COI). We only
    # need the company details the agreement is generated from. The W-9/COI are
    # requested automatically once the subcontractor signs (see the webhook).
    if not services.company_complete(sub):
        raise HTTPException(
            status_code=409,
            detail="Add the company's details (legal name, address, contact, email, phone) before sending the agreement.",
        )
    try:
        env = aesign.create_agreement_envelope(
            sub, axus_signer={"name": user.name, "email": user.email})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"aesign error: {e}")
    cfg = get_config(db)
    link = AgreementLink(
        subcontractor_id=sub.id, envelope_id=env["envelope_id"],
        agreement_version=cfg_version(cfg), status="draft",
    )
    db.add(link)
    sub.agreement_status = "pending_signature"
    log_activity(db, sub.id, user.email, "agreement_drafted",
                 detail=f"Subcontractor Agreement drafted in eSign for review (envelope {env['envelope_id']})")
    db.commit()
    return {"envelope_id": env["envelope_id"], "review_url": env.get("review_url"),
            "status": "draft"}


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
    if payload.status in ("subcontractor_signed", "partially_completed"):
        # The subcontractor has signed (first signature); Axus still counter-signs.
        # We only record it — the W-9/COI request is sent once at company creation,
        # not tied to signing.
        if link.status not in ("partially_signed", "completed"):
            log_activity(db, sub.id, None, "agreement_subcontractor_signed",
                         detail=f"Subcontractor signed the agreement; awaiting Axus counter-signature (envelope {env_id})")
        link.status = "partially_signed"
        services.recompute_compliance(db, sub)
        db.commit()
        return {"ok": True, "agreement_status": sub.agreement_status}

    if payload.status == "completed":
        cfg = get_config(db)
        signed = _parse_dt(payload.signedAt) or now
        link.status = "completed"
        link.signed_at = signed
        link.sha256 = payload.sha256
        link.renewal_date = _add_months(signed.date(), cfg.agreement_renewal_months)
        log_activity(db, sub.id, None, "agreement_signed",
                     detail=f"Subcontractor Agreement signed (envelope {env_id})")
        # Keep a copy of the fully-signed agreement in the subcontractor system,
        # next to the W-9 and COI (the original also stays in eSign).
        try:
            content, fname, ctype = aesign.fetch_agreement_pdf(env_id)
            stored_name = storage.save_encrypted(content)
            doc = SubcontractorDocument(
                subcontractor_id=sub.id, doc_type="agreement",
                version=services.next_version(db, sub.id, "agreement"),
                status="approved", stored_name=stored_name,
                original_filename=fname, content_type=ctype, size=len(content),
                uploaded_by="esign", reviewed_by="esign", reviewed_at=now,
            )
            db.add(doc)
            log_activity(db, sub.id, None, "agreement_copy_stored",
                         detail=f"Signed agreement copied into documents ({fname})")
        except Exception as e:  # don't fail the webhook if the copy can't be fetched
            log_activity(db, sub.id, None, "agreement_copy_failed",
                         detail=f"Could not copy signed agreement from eSign: {e}")
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

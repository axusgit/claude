"""Client for the aesign e-signature service (server-to-server, internal network).

Mirrors the On-Call -> eSign external integration precedent: POST to aesign's
external API (bearer-token auth) to create a Subcontractor Agreement envelope and
get back a signing URL. aesign owns the document/version/signature/audit; we keep
only a pointer (see models/agreement_link.py). Completion comes back via our
webhook (routers/agreements.py).

Requires, on the aesign side (staged spec — not yet applied to the live service):
  POST /api/external/agreements  {doc_type:"SUBCONTRACTOR", recipient, company,
       callback_url}  ->  {envelopeId, signUrl, status}
and a completion callback POST to `callback_url` with
  {envelopeId, status:"completed", sha256, signedAt, signer}
"""
import os
import httpx

AESIGN_URL = os.getenv("AESIGN_INTERNAL_URL", "http://aesign:8000")
AESIGN_TOKEN = os.getenv("AESIGN_EXTERNAL_API_TOKEN", "")
# Where aesign should POST the completion callback (our internal address).
CALLBACK_URL = os.getenv("SUBCONTRACTORS_CALLBACK_URL",
                         "http://subcontractors:8000/api/aesign/webhook")


def is_configured() -> bool:
    return bool(AESIGN_TOKEN)


def create_agreement_envelope(sub) -> dict:
    """Ask aesign to generate + send the Subcontractor Agreement for `sub`.
    Returns {envelope_id, sign_url, status}. Raises on failure."""
    payload = {
        "doc_type": "SUBCONTRACTOR",
        "recipient": {"name": sub.primary_contact_name or sub.legal_name, "email": sub.email},
        "company": sub.legal_name,
        "callback_url": CALLBACK_URL,
        "send": True,
    }
    r = httpx.post(
        f"{AESIGN_URL}/api/external/agreements",
        json=payload,
        headers={"Authorization": f"Bearer {AESIGN_TOKEN}"},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    return {
        "envelope_id": data.get("envelopeId") or data.get("envelope_id"),
        "sign_url": data.get("signUrl") or data.get("sign_url"),
        "status": data.get("status", "sent"),
    }

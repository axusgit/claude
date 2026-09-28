"""Agreement e-sign: staff send (aesign mocked) + completion webhook."""
import os


def _mk(make_vendor):
    return make_vendor("Agreement Co")


def test_send_agreement_and_webhook_completes(client, make_vendor, monkeypatch):
    os.environ["AESIGN_EXTERNAL_API_TOKEN"] = "test-token"
    # reload modules that captured the token at import time
    import importlib
    from app import aesign as aesign_mod
    from app.routers import agreements as agr_mod
    importlib.reload(aesign_mod)
    importlib.reload(agr_mod)

    # mock the outbound aesign call
    monkeypatch.setattr(aesign_mod, "is_configured", lambda: True)
    monkeypatch.setattr(aesign_mod, "create_agreement_envelope",
                        lambda sub: {"envelope_id": "env_XYZ", "sign_url": "https://aesign/sign/tok", "status": "sent"})
    monkeypatch.setattr(agr_mod.aesign, "is_configured", lambda: True)
    monkeypatch.setattr(agr_mod.aesign, "create_agreement_envelope",
                        lambda sub: {"envelope_id": "env_XYZ", "sign_url": "https://aesign/sign/tok", "status": "sent"})

    v = _mk(make_vendor)
    r = client.post(f"/api/subcontractors/{v['id']}/agreement/send")
    assert r.status_code == 200, r.text
    assert r.json()["envelope_id"] == "env_XYZ"

    # webhook without token -> 401
    assert client.post("/api/aesign/webhook", json={"envelopeId": "env_XYZ", "status": "completed"}).status_code == 401
    # webhook with token completes the agreement + sets renewal date
    r = client.post("/api/aesign/webhook",
                    headers={"Authorization": "Bearer test-token"},
                    json={"envelopeId": "env_XYZ", "status": "completed", "sha256": "abc",
                          "signedAt": "2026-09-28T12:00:00Z"})
    assert r.status_code == 200, r.text
    assert r.json()["agreement_status"] in ("current", "renewal_due")

    detail = client.get(f"/api/subcontractors/{v['id']}").json()
    assert detail["agreement_signed_date"] == "2026-09-28"
    # renewal 24 months later
    assert detail["agreement_renewal_date"] == "2028-09-28"

"""Agreement e-sign: staff send (aesign mocked) + completion webhook."""
import os


def _mk(make_vendor):
    # Inverted flow sends the agreement FIRST, which requires the company details it's
    # generated from (legal_name/email come from make_vendor; add the rest).
    return make_vendor("Agreement Co", address="1 Main", city="Tampa", state="FL",
                       zip="33626", primary_contact_name="Pat", phone="813-555-0100")


def test_send_agreement_and_webhook_completes(client, make_vendor, monkeypatch):
    os.environ["AESIGN_EXTERNAL_API_TOKEN"] = "test-token"
    # reload modules that captured the token at import time
    import importlib
    from app import aesign as aesign_mod
    from app.routers import agreements as agr_mod
    importlib.reload(aesign_mod)
    importlib.reload(agr_mod)

    # mock the outbound aesign call (create returns a DRAFT; axus_signer kwarg accepted)
    _fake_env = {"envelope_id": "env_XYZ", "review_url": "https://aesign/envelopes/env_XYZ", "status": "draft"}
    monkeypatch.setattr(aesign_mod, "is_configured", lambda: True)
    monkeypatch.setattr(aesign_mod, "create_agreement_envelope",
                        lambda sub, axus_signer=None: _fake_env)
    monkeypatch.setattr(agr_mod.aesign, "is_configured", lambda: True)
    monkeypatch.setattr(agr_mod.aesign, "create_agreement_envelope",
                        lambda sub, axus_signer=None: _fake_env)

    v = _mk(make_vendor)
    r = client.post(f"/api/subcontractors/{v['id']}/agreement/send")
    assert r.status_code == 200, r.text
    assert r.json()["envelope_id"] == "env_XYZ"

    # subcontractor-signed callback (first signature) flips the link to partially_signed
    r = client.post("/api/aesign/webhook",
                    headers={"Authorization": "Bearer test-token"},
                    json={"envelopeId": "env_XYZ", "status": "subcontractor_signed"})
    assert r.status_code == 200, r.text

    # webhook without token -> 401
    assert client.post("/api/aesign/webhook", json={"envelopeId": "env_XYZ", "status": "completed"}).status_code == 401
    # webhook with token completes the agreement (Axus counter-signed) + sets renewal date
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

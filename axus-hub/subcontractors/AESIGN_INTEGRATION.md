# aesign integration — the agreement e-signature piece

The Subcontractor Agreement is signed in the **live aesign** service, not
reimplemented here. The subcontractors side is complete and tested:

- `app/aesign.py` — calls `POST {AESIGN_INTERNAL_URL}/api/external/agreements`
  (bearer = `AESIGN_EXTERNAL_API_TOKEN`) to create + send the agreement envelope.
- `POST /api/subcontractors/{id}/agreement/send` — staff trigger; records an
  `AgreementLink(status="sent")`.
- `POST /api/aesign/webhook` — receives completion, sets `signed_at`, computes the
  24-month `renewal_date`, stores `sha256`, recomputes compliance, and closes any
  open `agreement_renewal` request. Bearer-gated; server-to-server over the Docker
  network (no Traefik route).

## What must be added on the aesign side (a small, additive pass)

aesign already has the hard parts (envelopes, tokenized signer links, sealed PDF +
certificate, ESIGN/UETA audit, letterhead generators, and the On-Call→eSign
external-intake + completion-callback precedent). Reuse those:

1. **Agreement generator** — add `backend/src/subpdf.ts`
   (`generateSubcontractorPdf → { bytes, layout }`) mirroring `slapdf.ts` /
   `baapdf.ts`: render the approved Subcontractor Agreement on the Axus letterhead
   with two auto-placed signer slots (Signature / Printed Name / Title / Date) and
   an embedded version string (e.g. `v1.0`) — bumping that string is the
   versioning mechanism; existing envelopes keep their stored snapshot.
   Source text: `axus-hub/subcontractors/agreements/subcontractor-agreement-v1-draft.md`
   (pending John's approval). Alternatively drop an approved PDF/DOCX in
   aesign's `templates/` and register it in `TEMPLATE_FILES` (DOCX auto-converts
   via Gotenberg).

2. **External create route** — add `POST /api/external/agreements` in
   `backend/src/routes/external.ts` (sibling of the existing `/api/external/quotes`):
   accept `{ doc_type:"SUBCONTRACTOR", recipient:{name,email}, company, callback_url, send }`,
   generate the agreement, create the envelope with the recipient as sole signer,
   auto-place fields from the returned layout, send the signer email, and return
   `{ envelopeId, signUrl, status }`. It already sits behind `EXTERNAL_API_TOKEN`
   on the `aesign-public` Traefik router.

3. **Generalize the completion callback** — `backend/src/oncall.ts` hardcodes the
   callback to On-Call quotes (`isOnCallQuote`). Add a parallel path (or a generic
   per-envelope `callback_url` column) so a completed SUBCONTRACTOR envelope POSTs
   `{ envelopeId, status:"completed", sha256, signedAt, signer }` to the
   subcontractors webhook. Hook points already exist in both the e-sign completion
   path (`sign.ts`) and the offline-upload completion path (`envelopes.ts`).

No changes needed to aesign storage, DB, auth, sealing, or the signer portal.

> Because this edits the **live** aesign service, do it as its own reviewed change
> and deploy in a change window (rebuild only the `aesign` service). The
> subcontractors side needs no change when it lands — just set
> `AESIGN_EXTERNAL_API_TOKEN` (already shared) in `infra/.env`.

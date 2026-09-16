# Axus eSign — document templates

Reusable *stored* source documents that get uploaded into an envelope when creating a
non-generated document type. **Currently empty** — the branded document types are all
**generated on the fly** in code (on the Axus letterhead), not stored here:

- **BAA** → `backend/src/baapdf.ts` (`generateBaaPdf`)
- **SLA** → `backend/src/slapdf.ts` (`generateSlaPdf`)
- **Certificate of Completion** → `backend/src/cocpdf.ts` (`generateCocPdf`)
- **Quote** → `backend/src/quotepdf.ts` (`generateQuotePdf`)

All four draw `backend/assets/letterhead.jpg` as a full-page background and keep content
inside the letterhead's clear zone (top-based Y `150 … 704`).

## If you add a stored-template type later
- One file per template, named `axus-<type>.<ext>` (e.g. `axus-foo.pdf`, `axus-foo.docx`).
- **PDF** preferred (deterministic); **DOCX** is converted to PDF via Gotenberg on upload.
- Register it in `TEMPLATE_FILES` in `backend/src/routes/envelopes.ts` (both `apply-template`
  and `template-preview`) — a file drop alone does nothing.

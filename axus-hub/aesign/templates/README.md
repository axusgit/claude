# Axus eSign — document templates

Reusable source documents that get uploaded into an envelope when creating a
non-Quote document (SOW / MSA / BAA). Quotes are generated on the fly and do not
live here.

## Conventions
- One file per template, named `axus-<type>.<ext>` (e.g. `axus-baa.pdf`, `axus-msa.docx`).
- **PDF** is preferred (exact layout, deterministic field placement). **DOCX** is
  also accepted — the app converts it to PDF via Gotenberg on upload.
- Include a clear signature block so the click-to-place editor can auto-fill
  fields on the blanks, e.g.:

  ```
  Signature: ______________________    Date: __________
  Printed Name: ___________________
  Title: __________________________
  ```

Drop new templates here; wiring a template to a document type is a code change
in the e-sign app (frontend/backend), not just a file drop.

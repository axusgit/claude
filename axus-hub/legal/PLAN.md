# Axus Legal — build plan

**Product:** `Axus Legal` — the home for all Axus legal activity: SOW/MSA signing,
quote generation & emailing, contract templates. Hub product tile at
`legal.hub.axustechnologies.com`, gated by Authentik SSO for staff; external
signers use email links (no Axus account).

**Goal:** replace Adobe Sign before **Sept 25, 2026** with a fully-owned Axus
product — no license cost, no lock-in, no per-envelope fees.

**Decision (2026-08-18):** build custom (own the IP), using only
permissive/MIT/Apache libraries. Adopt-an-engine (DocuSeal) kept as a fallback
if the custom signing core slips (see Risk & fallback).

---

## Two tools in v1 (both by Sept 25)
1. **Sign** — DocuSign-style: upload SOW/MSA (Word or PDF) → place fields → send
   to parties → each fills & signs → sealed completed PDF + certificate of
   completion (audit trail).
2. **Quotes** — build a quote from line items → branded PDF → email to client →
   optionally route straight into the Sign flow for signature.

## Stack (all owned, free, fits the Hub)
- **Frontend:** React + Vite + Tailwind + shadcn/ui (Axus design language).
  PDF render via **PDF.js**; field placement is a custom overlay on the canvas;
  signature capture via **signature_pad**.
- **Backend:** Node + Fastify. **Postgres** (platform DB) for envelopes,
  recipients, fields, events. Object storage on disk volume (originals + sealed).
- **Documents:** **Gotenberg** (containerized LibreOffice, Apache-2.0) for
  Word→PDF; **pdf-lib** (MIT) to stamp fields/signatures and seal the final PDF.
- **Email:** existing M365 SMTP relay (send from an Axus address).
- **Auth:** Traefik + Authentik forward-auth for staff; signer links are
  tokenized one-time URLs (no login).
- **Packaging:** `axus-hub/legal/` container(s) in `infra/docker-compose.yml`,
  Traefik route + `app-legal` gate, like every other Hub product.

## Data model (first cut)
- `envelope` (id, title, status, created_by, source_file, sealed_file, hash,
  created_at, completed_at)
- `recipient` (id, envelope_id, name, email, role, order, status, sign_token,
  signed_at, ip, user_agent, consent_at)
- `field` (id, envelope_id, recipient_id, type[signature|initials|date|text|
  checkbox], page, x, y, w, h, value, required)
- `event` (id, envelope_id, actor, type[created|sent|viewed|signed|completed],
  at, ip, hash) — append-only audit log

## Legal validity (US ESIGN / UETA)
No PKI certificate is legally required. Validity comes from:
- **Consent** to do business electronically (captured, timestamped, per signer)
- **Intent** to sign (explicit "Sign" action, drawn/typed signature)
- **Attribution** (email token + IP + user-agent + timestamp per event)
- **Integrity** (SHA-256 of the sealed PDF; append-only event log; tamper-evident)
- **Retention** (sealed PDF + certificate of completion stored, downloadable)
Optional later: cryptographic PDF signature/seal with an Axus cert.

## v1 scope — IN
Sequential + parallel multi-party signing · field types signature/initials/date/
text/checkbox · Word & PDF upload · email invites + reminders · signer consent +
audit trail · sealed PDF + certificate of completion · reusable SOW/MSA/quote
templates · quote line-item builder → PDF → email.

## Cut for good (confirmed 2026-08-18 — not needed for Axus)
SMS / ID verification of signers · bulk send · payments.

## Deferred (maybe later, not v1)
Conditional/branching fields · in-person signing · advanced roles/approval
chains · e-notary · cryptographic PKI seal.

## Settings
Sender ("from") address for signature requests & quotes: **support@axustechnologies.com**
(placeholder; will change later — keep it configurable via env).

## Risk & fallback
Build the **signing core first** (weeks 1–2) and validate end-to-end with a real
SOW by ~mid-Sept. On track → ship custom. Slips → drop in self-hosted **DocuSeal**
temporarily so the Adobe cutover on Sept 25 is never at risk.

## Progress
- **2026-08-18 — Wk1 vertical slice built & compiling (backend + frontend).**
  Backend (Fastify+Postgres): envelope/recipient/field/event model with an
  append-only audit log; forward-auth staff identity; create/list/get envelopes,
  upload document, stream PDF, save recipients + fields. Frontend (Vite+React+
  Tailwind, Axus look): document list + create; editor with PDF.js render,
  recipients panel, field toolbar, click-to-drop + drag fields per party, save.
  Both typecheck + build, 0 npm vulnerabilities. Not yet deployed (no live
  DB/browser test locally — Docker not installed on the dev machine).
- **Next:** deploy to a box (Postgres + Traefik route + Authentik `app-legal`
  gate + DNS) so it's clickable; then Word→PDF (Gotenberg) + send/sign flow.

## Milestones
- **Wk 1:** scaffold app + Hub wiring; upload→render→place fields→save.
- **Wk 2:** send flow (tokenized signer links) + sign UI + sealed PDF + audit.
- **Wk 3:** Word→PDF (Gotenberg), templates, reminders, certificate of completion.
- **Wk 4:** quotes (line-item builder → PDF → email → optional sign); internal testing.
- **Wk 5:** parallel-run vs Adobe with real SOWs/MSAs → cut over before Sept 25.

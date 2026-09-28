# Axus Subcontractor Management

A peer service in the Axus platform (like `support` and `aesign`) that manages the
full subcontractor/vendor lifecycle: **Invite → Onboard → Review → Approve →
Monitor Compliance → Renew Documents**. Reached through the Hub as the
`subcontractors` tile; identity, TLS, and routing come from the shared platform
(Authentik + Traefik). Requested by John Kahajas (Sept 2026).

> Status: **Phase-1 scaffold + data model.** No deployment has happened and no
> shared-stack files have been changed. Do not deploy until the open decisions
> below are settled and a change window is agreed (the platform is in production).

## Architecture

- **Backend:** FastAPI + SQLAlchemy + Alembic (mirrors the Support app).
- **Database:** its own `subcontractor` database on the shared Postgres instance
  (SQLite fallback for local dev).
- **Identity:** shared `libs/auth` (`axus_auth`) reading Authentik forward-auth
  headers. No local users table — staff are transient IdP identities; audit rows
  record the actor's email string (aesign's approach).
- **Two surfaces (planned):** an internal staff console on the `:8443` entrypoint
  (IP-locked, `geogate + authentik`), and a public onboarding portal on `:443`
  with `geogate` only (token-gated in-app) — the Support-portal routing pattern.
- **E-signature:** the Axus Subcontractor Agreement is **signed in aesign**, not
  reimplemented here. This service stores only a pointer (`agreement_links`) to
  the aesign envelope + renewal date. (Pending DECISION #2.)

## Layout

```
backend/
  main.py            FastAPI app (health, /api/me, /api/summary; routers added per milestone)
  run.py             uvicorn entrypoint
  app/
    database.py      engine/session/Base (Support conventions)
    auth.py          identity + granular permissions (view/create/edit/invite/review/
                     access_w9/approve/manage_agreements/override/deactivate/admin_config)
    mailer.py        shared O365 SMTP relay sender (never carries W-9 attachments)
    ids.py           AXV-000001 public-id formatting
    models/          the 11-table data model (see below)
    routers/         (added incrementally)
  alembic/           migrations; 0001_initial creates the full schema
frontend/            (added at the UI milestone; served same-origin)
Dockerfile           builds from repo root (COPYs libs/auth), applies migrations then serves
```

## Data model (migration `0001_initial`)

`subcontractors` (directory + denormalized compliance quick-view + AXV public id),
`subcontractor_contacts`, `subcontractor_services`, `subcontractor_documents`
(versioned W-9/COI, never overwritten), `onboarding_tokens` (hashed, reusable,
revocable), `document_requests` (idempotent reminder state machine),
`email_log` (per-recipient delivery — aesign-style; Support has none),
`subcontractor_activities` (audit), `subcontractor_notes` (internal-only),
`agreement_links` (pointer to aesign), `compliance_config` (admin-tunable rules;
defaults: COI notice 30d, reminder 7d, agreement 24mo, agreement notice 30d).

## Local dev

```bash
cd backend
python -m venv venv && ./venv/Scripts/pip install -r requirements.txt
./venv/Scripts/pip install -e ../../../libs/auth
./venv/Scripts/alembic upgrade head          # creates subcontractor_dev.db (SQLite)
AUTH_MODE=local ./venv/Scripts/python run.py  # dev admin identity synthesized
```

## Deployment plan (NOT yet executed — additive, blast-radius-aware)

When approved, this follows the documented "add a new app" pattern. Every step is
additive; the notes call out the shared-resource risks found in discovery.

1. **New DB (manual, one-off):** `docker compose exec postgres psql -U axus -c
   'CREATE DATABASE subcontractor;'` — `init.sql` is NOT re-run on a live cluster,
   so also add the line to `infra/postgres/init.sql` for clean rebuilds. Isolated;
   no locks on other DBs.
2. **Compose service** in `infra/docker-compose.yml`: build from repo root, inline
   env (incl. `DATABASE_URL=...@postgres/subcontractor`), `depends_on: postgres`,
   a dedicated **`subcontractor_data`** volume, `networks: [axus]`, and Traefik
   labels — a staff router (`internal`/:8443, `geogate,authentik`) + a public
   onboarding sub-router (higher priority, `/onboarding` + `/api/onboarding`,
   `geogate` only). Use a **unique Host() rule and unique router names**.
3. **Hub tile:** add one dict to `APP_CATALOG` in `hub/backend/main.py` (+
   `INTERNAL_URLS` for the command-center `/api/summary` feed).
4. **Authentik (additive):** add group `app-subcontractors` to
   `authentik/blueprints/axus-groups.yaml`, and a provider+application+policy
   binding to `axus-apps.yaml`. **Append** the new `!KeyOf provider-…` to the
   embedded-outpost `providers:` list — never replace it (replacing detaches other
   apps' SSO). Then `docker compose restart authentik-worker` (re-applies ALL
   blueprints, reverts manual UI edits — ensure everything is valid first).
5. **DNS:** A record `sub.hub.axustechnologies.com → 52.22.69.65` at Hover.
6. **Daily compliance job:** root host cron on the aesign-reminders.sh pattern
   (`cd infra && docker compose exec -T subcontractors python -m app.compliance`),
   logging to an app-writable path (not `/var/log/`).

**Never:** `docker compose down -v` (wipes `pg_data` + all app volumes); edit the
shared `x-authentik-env` anchor or postgres/redis/traefik blocks in the same
change (recreates shared containers → platform-wide blip). Scope
`docker compose up -d --build subcontractors` to this service.

## Decisions (John Kahajas, 2026-09-28)

2. ✅ **Reuse & extend the live aesign service** for the agreement.
3. ✅ **Agreement:** plain-language draft written at
   `agreements/subcontractor-agreement-v1-draft.md` for John to evaluate (shorter,
   friendlier, mutual — narrowed the clauses vendors pushed back on). Once
   approved it becomes a versioned aesign template. (Still worth diffing against
   the 2017 original if John wants specific clauses preserved.)
4. ✅ **US-based** vendors — the platform's US/CA geo-gate already covers this.
5. ✅ **Docs required:** W-9 **and** COI listing **Axus Technologies as additional
   insured** at 13046 Racetrack Rd., Suite 255, Tampa, FL 33626 (in
   `compliance_config`). **All uploaded docs are encrypted at rest** (Fernet,
   `app/storage.py`, key from `DOC_ENCRYPTION_KEY`).
6. ✅ **Uploads:** same extension allowlist as the ASD (18 types) + 25 MB cap;
   ClamAV not added for v1.
7. ✅ **Compliance-alert recipient:** `info@axustechnologies.com` (config default).

## Milestones

1. ✅ Scaffold + data model + baseline migration.
2. ✅ Staff directory (API + **vanilla-JS console UI**: dashboard tiles, searchable
   sortable directory, detail page, review actions, add modal).
3. ✅ Add/Invite + secure onboarding tokens (send/resend/cancel).
4. ✅ Public onboarding portal (API + **branded glass UI**: progress steps, company
   form, encrypted uploads, COI additional-insured notice, submit). Design signed off.
5. ✅ Secure document upload + download (**all docs encrypted at rest**, ASD
   extension allowlist, size cap, opaque names, permission-gated W-9 download).
6. 🔵 Agreement e-sign (aesign): **subcontractors side done + tested** (client +
   send endpoint + completion webhook + 24-mo renewal). aesign-side generator/route
   is a documented pass — see `AESIGN_INTEGRATION.md` (edits the live service).
7. ✅ Review/approval (approve / reject / request-correction / hold / inactive) +
   manual compliance override + internal notes.
8. ✅ Compliance engine — idempotent daily sweep (`python -m app.compliance`).
9. ✅ Email automation — all message types, `email_log`, per-day de-dup,
   soft-launch guardrails (`NOTIFY_ENABLED`/`NOTIFY_ALLOW`).
10. ✅ Audit trail + internal notes.
11. 🔵 Tests: pytest suite (8 flows incl. **vendor-token isolation**, **engine
    idempotency**, encryption, aesign webhook). Security review pending.
12. 🔵 Infra **staged, not deployed**: Hub tile (`APP_CATALOG`/`INTERNAL_URLS`),
    compose `subcontractors` service (staff SSO host + geogate-only portal paths),
    Authentik group + provider + app + **append-only** outpost binding, `init.sql`
    DB, `subcontractors-compliance.sh` cron.

**Nothing is deployed.** Applying the infra needs a change window (see the deploy
plan above): create the DB, `up -d --build subcontractors`, restart the
authentik-worker (re-applies blueprints), add DNS `subcontractors.hub…`, set
`SUBCONTRACTORS_DOC_ENCRYPTION_KEY` in `infra/.env`, install the cron.

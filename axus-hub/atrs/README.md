# Axus Time Reporting System (ATRS)

Time reporting for Axus contractors (1099) with an approval workflow.
`atrs.axustechnologies.com` — single Docker image (Node/Fastify backend serving a
React/Vite SPA), its own Postgres database (`atrs`), gated by Authentik SSO.

## Roles

Identity comes from the Authentik forward-auth proxy headers (same contract as
`libs/auth`). Two roles, derived from group membership:

| Role | Group(s) | Can |
|------|----------|-----|
| **Contractor** | `app-atrs` or `atrs-role-contractor` | Log their own time, submit for approval, edit/delete drafts & returned entries. |
| **Approver (admin)** | `atrs-role-admin` or `authentik Admins` | See everyone, approve / return submitted time, view per-contractor totals. |

A worker row is auto-created on first login (`GET /api/me`).

## Flow

1. Contractor logs an entry: **date + start + end** (hours auto-computed) **+ task**. It starts as a `draft`.
2. Contractor **submits** drafts → `submitted`. The approver is emailed.
3. Approver **approves** (`approved`) or **returns with a note** (`rejected`). The contractor is emailed.
4. Returned entries become editable again and can be resubmitted.

## API

- `GET  /api/me` — identity + role (upserts the worker).
- `GET  /api/entries` — list (contractor: own; admin: all, with `scope|status|from|to|worker`).
- `POST /api/entries` — create a draft `{work_date, start_time, end_time, task}`.
- `PATCH/DELETE /api/entries/:id` — edit/remove own draft or returned entry.
- `POST /api/entries/submit` — `{ids[]}` submit own drafts (emails approver).
- `POST /api/entries/decide` — admin `{ids[], decision:'approved'|'rejected', note?}` (emails contractor; note required to reject).
- `GET  /api/entries/summary` — totals (contractor: by status; admin: per worker).
- `GET  /api/workers`, `PATCH /api/workers/:email` — admin: roster + activate/deactivate.

## Deploy

Same pattern as eSign (see memory `axus-aesign-deploy`): push `main` → on the hub box
`git checkout <sha> -- axus-hub/atrs` → rsync into the build-context tree
`/home/ubuntu/axus-platform/axus-hub/atrs` (exclude `node_modules/.git/dist`) →
`cd infra && docker compose build atrs && docker compose up -d atrs`.
The schema is applied idempotently at startup — no migration step.

On a first deploy also: create the `atrs` database
(`docker compose exec postgres psql -U axus -c 'CREATE DATABASE atrs;'`), apply the
Authentik blueprints (restart `authentik-server`), and add the DNS A record
`atrs.axustechnologies.com → 52.22.69.65`.

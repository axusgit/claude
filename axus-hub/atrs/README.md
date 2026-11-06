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

## Categories & reports

Every entry has a **category**: `work` (default), `pto`, `holiday`, `sick`, or
`unpaid`. All categories use the same date + start/end → hours model and the same
submit → approve flow; a description is required only for `work`.

Each contractor has a **pay rate** ($/hour), set by an admin on the **Team** tab
(which also activates/deactivates people). **Pay = worked hours × rate** — leave
categories are tracked as hours only (not auto-valued). Reports show a "Worked pay"
total, a per-category/per-contractor $ breakdown, and Rate + Amount columns in the CSV.

The **Reports** tab (both roles) totals time over a period — presets **This/Last
week, This/Last month, This year** (weeks start Sunday) or a custom range — broken
down by category and status. Contractors see their own; approvers see everyone,
with a per-contractor table and a contractor filter. **Export CSV** downloads the
detail for invoicing/payroll. Rollups and CSV are computed client-side from the
entries list (no separate report endpoint).

## Work week & weekly approver reminder

The work week is **Sunday 00:00 → Saturday 23:59 (America/New_York)**; contractors
should submit no later than **Saturday 23:59**. At the start of each new week the
approver is emailed a summary of everything still awaiting approval (grouped by
contractor, with totals) so nothing lingers.

- Job: `backend/src/jobs/weeklyApproverReminder.ts` → `dist/jobs/weeklyApproverReminder.js`.
  It computes the just-closed Sun–Sat week in ET, lists all `submitted` (undecided)
  entries, and emails `ATRS_APPROVER_EMAIL` (default `info@…`). It sends only when
  something is pending, and is safe to run by hand any time.
- Schedule: a **host cron on the hub box** (not in the image), pinned to Eastern:
  ```
  CRON_TZ=America/New_York
  0 8 * * 0  docker exec axus-atrs-1 node dist/jobs/weeklyApproverReminder.js >> /home/ubuntu/atrs-weekly-reminder.log 2>&1
  ```
  → **Sunday 08:00 ET**. Manual test: `docker exec axus-atrs-1 node dist/jobs/weeklyApproverReminder.js`.

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

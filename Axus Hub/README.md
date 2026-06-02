# Axus Hub

Internal hub for Axus Technologies: clients, tickets, time tracking, and invoicing.
FastAPI backend with JWT auth.

## Backend

### Setup

```powershell
cd "Axus Hub/backend"
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env   # then edit .env
```

Generate a real `SECRET_KEY` and set it in `.env`.

### Database

- **Production:** PostgreSQL — set `DATABASE_URL=postgresql://user:pass@host/dbname`.
- **Local dev (no Postgres needed):** `DATABASE_URL=sqlite:///./axushub.db`.

Tables are created automatically on startup.

### Run

```powershell
.\venv\Scripts\python.exe run.py
```

`HOST`, `PORT`, and `RELOAD` are read from the environment (see `.env.example`).
The server binds to `0.0.0.0` by default so it is reachable externally — on AWS,
make sure the chosen `PORT` is open in the security group.

- Health check: `GET /api/health`
- Interactive API docs: `/docs`
- **Client portal UI:** open `/` in a browser (served from `../frontend`).
- **Technician console (staff service desk):** open `/staff` — queue, filters, stats,
  and a full working view per ticket (edit status/priority/assignee, public + internal
  replies, time logging, attachments, activity timeline).

### API overview

| Area | Routes |
|------|--------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Clients | `GET/POST /api/clients/`, `GET/PUT /api/clients/{id}` |
| Tickets | `GET/POST /api/tickets/`, `GET/PUT /api/tickets/{id}` |
| Ticket time | `GET/POST /api/tickets/{id}/time` |
| Ticket conversation | `GET/POST /api/tickets/{id}/comments` (`is_internal` separates staff notes from client-visible replies; `?public_only=true` hides internal notes) |
| Ticket activity log | `GET /api/tickets/{id}/activity` (audit trail of lifecycle events) |
| Ticket attachments | `POST` (multipart) / `GET` list / `GET /{attachment_id}` download / `DELETE` under `/api/tickets/{id}/attachments` |
| Portal provisioning | `POST /api/clients/{id}/portal-users` (staff creates a client login) |
| Customer contacts | `GET/POST /api/clients/{id}/contacts`, `PUT/DELETE /api/clients/{id}/contacts/{cid}` (people who belong to a customer) |
| Users (staff + portal) | `GET/POST /api/users/`, `PUT /api/users/{id}` (manage accounts: role, company, phone, status) |
| Client portal | `GET /api/portal/me`, `GET/POST /api/portal/tickets`, `GET /api/portal/tickets/{id}`, comments + attachments under it — all scoped to the user's own company |

Authenticated requests use a bearer token: `Authorization: Bearer <token>` from login.

### Ticketing (replacing Xcitium Service Desk)

- Each ticket gets a human-friendly **reference** (e.g. `AXUS-1001`) and a **category**.
- A **conversation thread** holds public replies and internal staff notes.
- An **activity log** automatically records creation, status/priority/assignee/category
  changes, time logged, comments, attachments, and SOW promotion.
- **Attachments** can be uploaded per ticket (optionally tied to a reply). Files are
  stored on disk under `UPLOAD_DIR` (default `uploads/`, gitignored) with a configurable
  size cap (`MAX_ATTACHMENT_MB`, default 25). Stored under random names to prevent
  collisions and path traversal.
- Tickets auto-promote from `standard` to `sow` once logged time reaches 8 hours.

## Status

Backend runs; auth, clients, and ticketing flows are verified end-to-end.

**Ticketing built:** tickets, time tracking, conversation thread, reference numbers,
categories, activity log, attachments, **client portal** (branded SPA, dark/light
theme; clients submit/reply/attach — scoped to their own company), and a
**technician console** at `/staff` (queue with filters + stats, live status/priority/
assignee editing, public + internal replies, time logging, attachments, activity).
**Admin built:** Customers (list/detail/edit, website, portal logins), Contacts
(people per customer), tickets carry a reporting contact, and a Users section
(manage staff & portal accounts — role, company, phone, status).
**Next:** service boards/queues, billing-ready time, email-to-ticket + notifications.
(No SLA tracking by design — Axus staff resolve issues ASAP rather than to fixed targets.)
**Billing (QuickBooks replacement) — not started:** invoices API (model exists,
no router), payments/A-R, tax, reports.

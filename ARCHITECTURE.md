# Axus Platform Architecture

Axus Hub is the **center of the ecosystem** — the identity provider, dashboard,
and launcher. Support / RMM / Accounting / Engineering are independent apps
reached through the Hub with one account, one credential set, one identity
provider, and one authorization model.

## Components

```
                 Internet — https://*.hub.axustechnologies.com
                                     │
                       ┌─────────────▼─────────────┐
                       │  Traefik  (reverse proxy) │  per-host Let's Encrypt
                       │  :80→:443, routes by Host │  (HTTP-01, DNS at Hover)
                       └──┬─────────┬─────────┬─────┘
        forward-auth ─────┘         │         └──────── one box, 52.22.69.65
        (Authentik outpost)         │
            ┌───────────────────────▼────────────────────────┐
            │ id.hub        →  Authentik   (IdP: OIDC, MFA)   │
            │ hub           →  Hub         (dashboard/launch) │
            │ support.hub   →  Support     (ticketing)        │
            │ rmm/accounting/engineering.hub  (future)        │
            └───────────────────────┬────────────────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │ PostgreSQL (authentik,    │   Redis (Authentik)
                       │ support dbs)              │
                       └───────────────────────────┘
```

All services run as **Docker Compose** containers on a single EC2 host; only
Traefik publishes 80/443. See `infra/docker-compose.yml`.

## Authentication

Authentik is the sole authentication authority. Traefik puts an Authentik
**forward-auth outpost** in front of every app:

```
unauthenticated → Traefik(authentik middleware) → 302 Authentik login (id.hub)
   → [password, MFA-ready] → back to app, now with identity headers injected:
     X-authentik-email / -name / -username / -groups  (+ X-Axus-Client-Id)
```

Apps never run their own login — they read the trusted headers via the shared
`libs/auth` module (`axus_auth.get_identity`). Support keeps a `local` JWT mode
(`AUTH_MODE=local`) only for standalone local development.

**SSO:** one Authentik session cookie spans every `*.hub` subdomain, so once you
log in at the Hub (or any app) you can launch the others without re-authenticating.

## Authorization

Permissions are central, modeled as Authentik **groups**:

| Group | Meaning |
|-------|---------|
| `app-support`, `app-rmm`, `app-accounting`, `app-engineering` | entitlement — may access that app |
| `role-admin` / `role-technician` / `role-finance` / `role-engineer` / `role-client` | role, mapped to the app's local role by `libs/auth` |

- **Access gating:** Traefik's Authentik middleware (bound to each app's
  Authentik *application* policy) allows only users in that app's group; others
  get denied. The Hub launcher independently shows only authorized tiles.
- **Role mapping:** `Identity.role` picks the highest `role-*` group; Support
  auto-provisions/syncs the local user (and `client_id` for portal users) on
  each request.

Example — a Support Technician (`role-technician`, `app-support`, `app-rmm`) can
reach Support and RMM, is denied Accounting/Engineering, and appears as a
`technician` inside Support.

## Repository layout

| Path | What |
|------|------|
| `apps/hub` | Central dashboard/launcher (FastAPI + static SPA) |
| `apps/support` | Support/ticketing (live app, formerly "Axus Hub") |
| `apps/rmm` | RMM scaffold (future) |
| `libs/auth` | Shared `axus_auth` identity package |
| `infra/` | `docker-compose.yml`, Traefik config, Authentik blueprints, `.env.example` |

## Adding a new app (the pattern)

1. Create `apps/<name>` (use `libs/auth` for identity).
2. Add a service + Traefik labels in `infra/docker-compose.yml` (Host rule +
   `authentik@file` middleware).
3. Add `<name>` to the Hub `APP_CATALOG` (`apps/hub/backend/main.py`) with its
   `app-<name>` group.
4. Add an A record `<name>.hub.axustechnologies.com → 52.22.69.65` at Hover.
5. In Authentik: create the `app-<name>` group + application/provider; assign users.

That's the whole extensibility story — wildcard-style growth without re-architecture.

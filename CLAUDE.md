# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **Axus Technologies platform monorepo**. Axus Hub is the central platform — identity provider (SSO via Authentik), dashboard, and application launcher. The other apps are independent systems reached through the Hub via centralized auth. See `ARCHITECTURE.md` and `DEPLOY.md`.

## Structure

| Path | Description |
|------|-------------|
| `apps/hub/` | **Central platform**: dashboard, app launcher, profile, monitoring, admin. OIDC/forward-auth client of Authentik. |
| `apps/support/` | **Support** platform (ticketing, service desk, customer portal) — `support.hub.axustechnologies.com`. Formerly mislabeled "Axus Hub". Live in prod. |
| `apps/rmm/` | RMM scaffold (future) — `rmm.hub.axustechnologies.com`. |
| `infra/` | Docker Compose stack: Traefik (reverse proxy + TLS), Authentik (IdP), Postgres, Redis. |
| `libs/auth/` | Shared central-identity module (reads Authentik forward-auth headers; dev fallback). |
| `Chess/`, `Hangman/`, `Tic Tac Toe/` | Unrelated standalone toys. |

## Conventions

- Each app lives under `apps/<name>/` and is independently runnable + deployable as a container.
- Python apps use a local `venv/` (gitignored) and their own `requirements.txt`; schema is managed by **Alembic** (`alembic upgrade head`), never `create_all`.
- Apps trust **Axus Hub / Authentik** as the single identity & authorization authority — no per-app login systems (a local dev fallback exists for running without Authentik).
- Secrets live in environment `.env` files (gitignored), never committed.

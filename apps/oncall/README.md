# On Call AI Agent

Axus platform app — **On Call AI Agent**.

Status: **placeholder / scaffolding pending.** Full structure will be created
to match the project spec.

Lives under `apps/oncall/` per the monorepo convention (each app is
independently runnable + deployable as a container). Auth comes from
Axus Hub / Authentik via `libs/auth` — no per-app login system. Schema, when
added, is managed by Alembic (never `create_all`).

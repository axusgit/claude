# Axus Support — Deployment & Updates

> **Note:** Support is being moved into the platform stack. Production will run at
> **https://support.hub.axustechnologies.com** as a container behind Traefik +
> Authentik — see the repo-root **`DEPLOY.md`** and **`ARCHITECTURE.md`**. The
> bare-metal/systemd instructions below describe the **legacy** deployment, valid
> only until the cutover completes. For local development, see "Local development"
> in the root `DEPLOY.md`.

## Legacy production environment (pre-cutover)

| Piece | Value |
|------|-------|
| Host | AWS EC2, Ubuntu 24.04 (`52.22.69.65`) |
| Code | `/var/www/axushub` (git clone of `origin/main`) |
| App | uvicorn `main:app` on `127.0.0.1:8000`, run by **systemd** service `axushub` |
| Web | **nginx** terminates TLS on 443, redirects 80→443, proxies to uvicorn |
| TLS | Let's Encrypt cert (certbot, auto-renews) |
| DB | PostgreSQL, database `axushub` (local) |
| Schema | managed by **Alembic** migrations (not auto-created) |

Environment config lives in `Axus Hub/backend/.env` **on the server** (never committed — it holds the prod `DATABASE_URL` and `SECRET_KEY`).

---

## Routine update (the normal case)

From your dev machine, changes reach `origin/main` (hourly auto-push or manual push). Then on the server:

```bash
bash "/var/www/axushub/Axus Hub/backend/deploy.sh"
```

`deploy.sh` does: **git pull → pip install → DB backup → `alembic upgrade head` → restart → health check.** Safe to re-run. After it finishes, hard-refresh the browser (Ctrl+Shift+R) to pick up frontend changes.

### One-time setup on the existing server (do this once)
The current prod DB was built by the app before Alembic existed, so baseline it to the initial migration **before the first `deploy.sh` run**:
```bash
cd "/var/www/axushub/Axus Hub/backend"
git pull origin main                     # get the alembic/ folder
./venv/bin/pip install -r requirements.txt
./venv/bin/alembic stamp head            # mark DB as already at the initial schema
sudo systemctl restart axushub
chmod +x deploy.sh                       # make the script executable
```
After this, always update with `deploy.sh`.

---

## Making a schema change (new/changed columns or tables)

Schema is **never** changed by dropping the database in production. Use a migration:

1. **On dev**, after editing the SQLAlchemy models, generate a migration:
   ```bash
   cd "Axus Hub/backend"
   ./venv/Scripts/alembic revision --autogenerate -m "describe the change"
   ```
   Review the generated file in `alembic/versions/`, then apply locally:
   ```bash
   ./venv/Scripts/alembic upgrade head
   ```
2. **Commit** the new migration file (it must reach `origin/main`).
3. **On the server**, `deploy.sh` applies it automatically via `alembic upgrade head`.

New *tables* and new *columns* are both handled by Alembic — no manual SQL.

---

## Manual deploy (if not using deploy.sh)

```bash
cd /var/www/axushub && git pull origin main
cd "Axus Hub/backend"
./venv/bin/pip install -r requirements.txt          # only if deps changed
sudo -u postgres pg_dump axushub > ~/axushub-$(date +%F).sql   # backup before migrations
./venv/bin/alembic upgrade head                     # only if there are new migrations
sudo systemctl restart axushub
curl -s http://127.0.0.1:8000/api/health            # expect {"status":"ok",...}
```

---

## Backups & rollback

- **Backup** (deploy.sh does this automatically into `~/axushub-backup-*.sql`):
  ```bash
  sudo -u postgres pg_dump axushub > ~/axushub-$(date +%F).sql
  ```
- **Restore** a backup:
  ```bash
  sudo systemctl stop axushub
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS axushub WITH (FORCE);"
  sudo -u postgres psql -c "CREATE DATABASE axushub OWNER axushub;"
  sudo -u postgres psql axushub < ~/axushub-YYYY-MM-DD.sql
  sudo systemctl start axushub
  ```
- **Roll back code**: `git -C /var/www/axushub reset --hard <previous-commit>` then restart. (If the bad deploy ran a migration, restore the DB backup too.)

---

## TLS / certificate

Certbot auto-renews. To check / force:
```bash
sudo certbot certificates
sudo certbot renew --dry-run
```
Renewal needs ports 80 and 443 open in the EC2 **Security Group**.

---

## Local development

```bash
cd "Axus Hub/backend"
python -m venv venv
./venv/Scripts/pip install -r requirements.txt
# .env with: DATABASE_URL=sqlite:///./axushub.db  + a SECRET_KEY
./venv/Scripts/alembic upgrade head     # build the schema
./venv/Scripts/python run.py            # http://localhost:8000
```

---

## Troubleshooting

| Symptom | Check |
|--------|-------|
| Service won't start | `sudo journalctl -u axushub -n 50 --no-pager` |
| 502 from nginx | app down — check the journal above |
| `/` returns `{"detail":"Not Found"}` | frontend folder missing or old code — `git pull` + restart |
| Migration error | restore the pre-deploy backup, fix the migration on dev, redeploy |
| Health check | `curl -s http://127.0.0.1:8000/api/health` |

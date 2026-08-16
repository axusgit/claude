# Axus Platform — Deployment & Operations

Production: single EC2 host `52.22.69.65`, Docker Compose stack in `infra/`.
See `ARCHITECTURE.md` for the design. The legacy bare-metal Support
(`systemd axushub` + nginx) is replaced by this stack via a **blue/green cutover**
— the old service keeps running until the new stack is validated.

> ⚠️ Until the cutover (step 5) completes, **do not** `git pull` / run the old
> `deploy.sh` on the host's legacy path — the repo restructure would break the
> running systemd service. The legacy app is unaffected as long as nobody pulls.

## 0. Prerequisites (operator)

1. **DNS at Hover** — add A records → `52.22.69.65`:
   `hub`, `support.hub`, `id.hub` (and `rmm.hub`, `accounting.hub`, … as apps land).
2. **Lightsail firewall** — open inbound **80** and **443** from anywhere
   (public apps + ACME), and **8443** **restricted to your office/VPN IPs only**
   (internal apps: Hub, Accounting, Engineering, RMM). Country allow/deny is
   handled in-app (Hub → Administration → Country access control), since
   Lightsail has no geo rules.
3. **Server** — install Docker Engine + Compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER   # re-login after
   ```
4. **Secrets** — `cp infra/.env.example infra/.env` and fill every `CHANGE_ME`
   (`openssl rand -base64 48` for keys/passwords).

## 1. First-time bring-up

```bash
cd /var/www/axushub        # the repo checkout (after it has pulled the restructure — see step 5)
cd infra
docker compose pull                 # pulls traefik, authentik, postgres, redis
docker compose up -d --build        # builds hub + support images, starts everything
docker compose ps                   # all healthy?
docker compose logs -f authentik-server   # watch for "startup complete"
```
Traefik issues each subdomain's cert on first HTTPS hit (needs 80/443 open + DNS live).

## 2. Authentik one-time setup (identity)

1. Browse to **https://id.hub.axustechnologies.com**. Finish initial setup / sign
   in as `akadmin` (password = `AUTHENTIK_BOOTSTRAP_PASSWORD`).
2. The blueprint auto-creates the groups (`app-*`, `role-*`). Verify under
   *Directory → Groups*.
3. For **each app** (start with Hub + Support): *Applications → Create* with a
   **Proxy Provider** in **forward-auth (single application)** mode, external host
   = the app's URL. Bind the **embedded outpost** (*Applications → Outposts →
   authentik Embedded Outpost → add the applications*).
4. Add a **policy binding** on each application requiring its `app-*` group (this
   is the access gate Traefik enforces).
5. Create your real users (or migrate), assign `role-admin` + the `app-*` groups
   they need. For Support *client portal* users: add `role-client`, `app-support`,
   and a `client_id` property mapping → header `X-Axus-Client-Id`.

## 3. Migrate Support data (from the legacy Postgres)

```bash
# dump the live database from the host Postgres
sudo -u postgres pg_dump axushub > ~/support-cutover.sql

# load it into the stack's Postgres (db "support" was created by init.sql)
docker compose cp ~/support-cutover.sql postgres:/tmp/s.sql
docker compose exec postgres psql -U axus -d support -f /tmp/s.sql
docker compose exec support alembic upgrade head     # ensure schema at head

# migrate historical ticket attachments into the support_uploads volume
# (adjust the legacy path if different); the DB stores only stored_name.
docker compose cp /var/www/axushub/backend/uploads/. support:/data/uploads/
```

## 4. Validate (before cutover)

- `curl -sI https://hub.axustechnologies.com` and `…/support.hub…` → valid cert, 200/redirect to login.
- Log into Hub → launcher shows your apps → click Support → no second login.
- A user without `app-support` → denied at Support; with it → allowed.
- Support data present (tickets/customers/users).

## 5. Cutover

The new stack already owns 80/443 (the legacy nginx must be stopped to free them):
```bash
sudo systemctl stop nginx axushub
sudo systemctl disable nginx axushub
```
(Now Traefik serves everything.) Keep `~/support-cutover.sql` until signed off.

## Routine updates

```bash
cd /var/www/axushub && git pull origin main
cd infra
docker compose up -d --build          # rebuilds changed app images
docker compose exec support alembic upgrade head   # if a migration shipped
```
Schema changes still use Alembic (generate + commit on dev; applied above).
Never drop the production database.

## Rollback

- App regression: `git checkout <prev>` then `docker compose up -d --build`.
- Bad data migration: restore `~/support-cutover.sql` into the `support` db.
- Full emergency: re-enable the legacy service (`systemctl enable --now nginx axushub`)
  after `docker compose down` — only valid before legacy is decommissioned.

## Local development (no Docker / no IdP)

Each app runs standalone with `AUTH_MODE=local`:
```bash
cd axus-hub/support/backend   # or axus-hub/hub/backend
python -m venv venv && ./venv/Scripts/pip install -r requirements.txt
./venv/Scripts/pip install -e ../../../libs/auth
# support only: ./venv/Scripts/alembic upgrade head
./venv/Scripts/python run.py
```
Support `local` mode uses the bcrypt/JWT login; Hub `local` mode shows a dev admin
identity. Set `DEV_USER_GROUPS` to simulate entitlements.

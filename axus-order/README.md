# Axus Order

Client-facing **IT hardware ordering + ballpark-quote** web app for Axus Technologies.
Clients browse a curated catalog, build a cart, and get an **indicative, non-binding
ballpark quote**. Pricing comes from the TD SYNNEX Partner API; the client only ever
sees the **marked-up ballpark**, never Axus's partner cost.

- **Stack:** Next.js 16 (App Router, TypeScript) · Tailwind v4 · Prisma 6 + SQLite
- **Auth:** delegated to the platform **Authentik** (forward-auth), like the other Hub
  products — no per-app login. A local dev fallback lets it run standalone.
- **Pricing source:** TD SYNNEX REST adapter (real) or a built-in **mock** (default),
  so the app runs with **zero TD SYNNEX keys** until you're ready.

---

## Quick start (local, mock pricing — no keys needed)

```bash
npm install
npx prisma migrate dev      # creates dev.db + Prisma client (auto-runs the seed)
npm run dev                 # http://localhost:3000
```

That's it. `SYNNEX_ADAPTER=mock` and `AUTH_MODE=local` are the defaults in `.env`, so
you get a synthetic admin identity and deterministic fake pricing. Browse the catalog,
add items, click **Get Quote**.

If the catalog is ever empty, seed it manually:

```bash
npm run seed                # seeds from Files/catalog-seed.csv (60 products)
RESEED=1 npm run seed       # wipe + reseed
```

---

## How it fits together

| Path | Role | Source |
|------|------|--------|
| `lib/synnex/adapter.ts` | TD SYNNEX REST adapter (OAuth2 + Price & Availability) | **provided, verbatim** |
| `lib/synnex/pricing.ts` | cost → ballpark margin (the cost→client boundary) | **provided, verbatim** |
| `lib/synnex/quote-service.ts` | cart + catalog → priced, client-safe quote | **provided** (one line: default adapter → `getAdapter()`) |
| `lib/synnex/mock.ts` | `MockSynnexAdapter` — same interface, fake data | new |
| `lib/synnex/index.ts` | `getAdapter()` — picks mock vs real from env | new |
| `app/api/quotes/route.ts` | POST builds+persists a quote; GET fetches one | **provided, verbatim** |
| `prisma/schema.prisma` | Catalog/Quote/QuoteLine models | **merged from provided `quote-schema.prisma`** |
| `Files/catalog-seed.csv` | 60 real products, seeded into the catalog | **provided** |
| `lib/auth.ts` | Authentik identity contract (TS port of `libs/auth/axus_auth`) | new |
| `proxy.ts` | defense-in-depth auth gate (Next 16 proxy convention) | new |
| `scripts/test-synnex.mjs` | your sandbox smoke test | **provided, verbatim** |
| `app/` UI | top nav, catalog-by-category, cart, quote view | new |

**Your originals in `Files/` are left untouched** as the source of truth; the app uses
placed copies. `Files/` is excluded from the TypeScript project.

### Cost safety
Partner cost lives only server-side: `adapter.ts` (`cost`), `pricing.ts` (converts it to
`unitBallpark` and drops it), `quote-service.ts` (`_serverCostByCatalogItemId`, never
serialized), and the `QuoteLine.unitCostSnapshot` DB column (never returned by the API).
No cost is logged or sent to the browser. Verified: quote API responses and rendered
HTML contain no cost field.

---

## Environment variables

See `.env.example`. Key ones:

| Var | Local default | Production |
|-----|---------------|------------|
| `DATABASE_URL` | `file:./dev.db` | `file:./prod.db` (or absolute path) |
| `SYNNEX_ADAPTER` | `mock` | `real` |
| `AUTH_MODE` | `local` | `central` |
| `APP_GROUP` | `app-order` | `app-order` |
| `DEV_USER_*` | synthetic dev identity | (unused when central) |
| `SYNNEX_CLIENT_ID` / `SYNNEX_CLIENT_SECRET` | — | your sandbox/prod keys |
| `SYNNEX_API_BASE` | `https://api-uat.us.tdsynnex.com` (sandbox) | prod base when live |

### Switching to real TD SYNNEX pricing
1. Put your keys in `.env`: `SYNNEX_CLIENT_ID`, `SYNNEX_CLIENT_SECRET`.
2. Set `SYNNEX_ADAPTER=real`.
3. Restart. (`SYNNEX_API_BASE` defaults to the UAT sandbox; set the production base
   when you go live.)

You can validate keys independently of the app with the provided smoke test:

```bash
SYNNEX_CLIENT_ID=xxx SYNNEX_CLIENT_SECRET=yyy npm run test:synnex 14025760
```

---

## Deploy to axus-server01 (Ubuntu · Nginx + PM2)

> Not deployed yet — these are the steps. Mirrors the other client-facing apps on the box.

**1. Get the code + build**
```bash
cd /home/ubuntu
git clone <repo> axus-order   # or pull into the existing monorepo checkout
cd axus-order
npm ci
```

**2. Production `.env`**
```env
DATABASE_URL="file:/home/ubuntu/axus-order/prod.db"
SYNNEX_ADAPTER=real
SYNNEX_CLIENT_ID=...
SYNNEX_CLIENT_SECRET=...
AUTH_MODE=central
APP_GROUP=app-order
```

**3. DB + build**
```bash
npx prisma migrate deploy     # apply migrations (no dev prompts)
npm run seed                  # first deploy only — loads the catalog
npm run build
```

**4. PM2**
```bash
PORT=3000 pm2 start "npm run start" --name axus-order
pm2 save
```
(Or an `ecosystem.config.js` with `env: { PORT: 3000, ... }` if you prefer.)

**5. Nginx + TLS** — `order.axustechnologies.com` → `127.0.0.1:3000`
```nginx
server {
    server_name order.axustechnologies.com;

    # --- Authentik forward-auth (see step 6) ---
    location /outpost.goauthentik.io/ {
        proxy_pass http://127.0.0.1:9000/outpost.goauthentik.io/;   # authentik outpost
        proxy_set_header Host $host;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        add_header Set-Cookie $auth_cookie;
        auth_request_set $auth_cookie $upstream_http_set_cookie;
    }

    location / {
        auth_request /outpost.goauthentik.io/auth/nginx;
        error_page 401 = @goauthentik_proxy_signin;

        # Trust the identity headers the outpost returns and pass them upstream.
        auth_request_set $authentik_email    $upstream_http_x_authentik_email;
        auth_request_set $authentik_username $upstream_http_x_authentik_username;
        auth_request_set $authentik_name     $upstream_http_x_authentik_name;
        auth_request_set $authentik_groups   $upstream_http_x_authentik_groups;
        proxy_set_header X-authentik-email    $authentik_email;
        proxy_set_header X-authentik-username $authentik_username;
        proxy_set_header X-authentik-name     $authentik_name;
        proxy_set_header X-authentik-groups   $authentik_groups;

        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location @goauthentik_proxy_signin {
        internal;
        add_header Set-Cookie $auth_cookie;
        return 302 /outpost.goauthentik.io/start?rd=$request_uri;
    }
}
```
Then `sudo certbot --nginx -d order.axustechnologies.com`.

> **Health check** `GET /api/health` is intentionally left unauthenticated (excluded in
> `proxy.ts`) so the Hub command center can probe it — keep it outside the `auth_request`
> block if you tighten the config.

**6. Authentik**
- Create a **Proxy Provider** (Forward auth, single application) + **Application** for
  `order.axustechnologies.com`, attached to the box's Nginx outpost.
- Create the group **`app-order`** and add the users/clients who should have access.
  Membership drives both the Hub tile visibility and the app's `APP_GROUP` gate.
- The app reads `X-authentik-email/username/name/groups` via `lib/auth.ts` — the same
  contract as `libs/auth/axus_auth`. `proxy.ts` refuses any request lacking a valid
  identity or the `app-order` group.

**7. Hub tile** — already added to `axus-hub/hub/backend/main.py` `APP_CATALOG`:
```python
{"key": "order", "name": "Order", "desc": "IT hardware ordering & ballpark quotes",
 "group": "app-order", "icon": "🛒", "internal": False,
 "url": "https://order.axustechnologies.com",
 "health": "https://order.axustechnologies.com/api/health"},
```
Deploy the Hub (per the Hub's own deploy procedure) to surface the tile. Users see it only
if they're in `app-order`.

---

## Notes
- There is **no in-app login or marketing home page** by design — the entry point is the
  Hub tile, and Authentik owns authentication.
- SQLite is fine for the MVP. If concurrency grows, switch the Prisma datasource to
  Postgres (the box already runs Postgres for other apps) and re-run migrations.

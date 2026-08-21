"""Axus Hub — central platform: dashboard, application launcher, identity surface.

Auth is delegated to the platform (Authentik forward-auth); the Hub itself only
reads the identity and shows each user the apps they're entitled to. In local dev
(AUTH_MODE=local) a synthetic identity is used so the dashboard runs standalone.
"""
import os
import httpx
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List

from axus_auth import get_identity, Identity
import geo

PLATFORM_DOMAIN = os.getenv("PLATFORM_DOMAIN", "hub.axustechnologies.com")
AUTHENTIK_URL = os.getenv("AUTHENTIK_URL", f"https://id.{PLATFORM_DOMAIN}")
# Internal-only apps are served on this port (IP-restricted in the AWS SG);
# client-facing apps (Support) stay on the default 443.
INTERNAL_PORT = os.getenv("INTERNAL_PORT", "8443")

# The catalog of connected applications. Each app is gated by an Authentik
# entitlement group; admins see everything. `internal` apps are Axus-staff-only
# (served on :8443); non-internal apps are client-facing (:443).
APP_CATALOG = [
    {"key": "support", "name": "Support", "desc": "Tickets, service desk & customer portal", "group": "app-support", "icon": "🎫", "internal": False, "staff_path": "/staff"},
    {"key": "insights", "name": "Insights", "desc": "Meraki monitoring, IPAM & reliability", "group": "app-insights", "icon": "📊", "internal": False, "url": "https://ain.axustechnologies.com/auth?sso=1", "health": "https://ain.axustechnologies.com/"},
    {"key": "rmm", "name": "RMM", "desc": "Remote monitoring & management", "group": "app-rmm", "icon": "🖥️", "internal": True},
    {"key": "accounting", "name": "Accounting", "desc": "Billing, invoicing & financials", "group": "app-accounting", "icon": "💰", "internal": False},
    {"key": "esign", "name": "Axus eSign", "desc": "E-signatures, agreements & quotes", "group": "app-aesign", "icon": "✍️", "internal": False, "url": "https://aesign.axustechnologies.com"},
    # On-Call: launcher tile + live health only. It keeps its OWN login/auth —
    # NOT gated by Authentik forward-auth (app-oncall just controls tile visibility).
    {"key": "oncall", "name": "On-Call", "desc": "After-hours on-call answering & escalation", "group": "app-oncall", "icon": "📞", "internal": False, "url": "https://oncall.axustechnologies.com", "health": "https://oncall.axustechnologies.com/health"},
    {"key": "engineering", "name": "Engineering", "desc": "Projects, docs & dev-ops", "group": "app-engineering", "icon": "🛠️", "internal": True},
    {"key": "marketing", "name": "Axus Marketing", "desc": "Newsletters, email campaigns & automation", "group": "app-marketing", "icon": "📣", "internal": True, "coming_soon": True},
]

# Internal (Docker-network) URLs used to pull each app's KPI summary
# server-to-server for the command-center dashboard. Apps absent here show as
# "not yet connected".
INTERNAL_URLS = {
    "support": os.getenv("SUPPORT_INTERNAL_URL", "http://support:8000"),
    "accounting": os.getenv("ACCOUNTING_INTERNAL_URL", "http://accounting:8000"),
    "esign": os.getenv("ESIGN_INTERNAL_URL", "http://aesign:8000"),
    # "rmm": os.getenv("RMM_INTERNAL_URL", "http://rmm:8000"),
    # "engineering": os.getenv("ENGINEERING_INTERNAL_URL", "http://engineering:8000"),
}

app = FastAPI(title="Axus Hub", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|([a-z0-9-]+\.)*hub\.axustechnologies\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _apps_for(identity: Identity):
    is_admin = identity.role == "admin"
    is_client = identity.role == "client"
    apps = []
    for a in APP_CATALOG:
        authorized = is_admin or identity.has_group(a["group"])
        if authorized:
            port = f":{INTERNAL_PORT}" if a.get("internal") else ""
            # Some apps split staff vs client UIs by path (e.g. Support's staff
            # desk at /staff vs the customer portal at /). Staff/admins get the
            # staff path; clients get the default (portal) root.
            path = "" if is_client else a.get("staff_path", "")
            # Apps hosted outside *.hub (e.g. Insights at ain.axustechnologies.com)
            # can pin an explicit URL; others are derived from the key + domain.
            url = "#" if a.get("coming_soon") else (a.get("url") or f"https://{a['key']}.{PLATFORM_DOMAIN}{port}{path}")
            apps.append({**a, "url": url})
    return apps


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Axus Hub"}


@app.get("/api/me")
def me(request: Request):
    identity = get_identity(request)
    return {
        "email": identity.email,
        "name": identity.name,
        "username": identity.username,
        "role": identity.role,
        "groups": identity.groups,
        "is_admin": identity.role == "admin",
        "apps": _apps_for(identity),
        "authentik_url": AUTHENTIK_URL,
        "admin_url": f"{AUTHENTIK_URL}/if/admin/" if identity.role == "admin" else None,
        "account_url": f"{AUTHENTIK_URL}/if/user/",
    }


@app.get("/api/dashboard")
async def dashboard(request: Request):
    """Command-center KPIs: each authorized app's /api/summary, aggregated."""
    identity = get_identity(request)
    systems = []
    async with httpx.AsyncClient(timeout=2.5) as client:
        for a in _apps_for(identity):
            if a.get("coming_soon"):
                continue
            base = {"app": a["key"], "name": a["name"], "icon": a["icon"], "url": a["url"]}
            internal = INTERNAL_URLS.get(a["key"])
            if internal:
                try:
                    r = await client.get(f"{internal}/api/summary")
                    if r.status_code == 200:
                        s = r.json()
                        systems.append({**base, "available": True, "kpis": s.get("kpis", []), "footnote": s.get("footnote")})
                        continue
                except Exception:
                    pass
            systems.append({**base, "available": False, "kpis": []})
    return {"systems": systems}


# ----- Geo access control (edge gate + admin policy) -----

@app.get("/api/geo/check")
def geo_check(request: Request):
    """Traefik forward-auth gate: allow/deny by source country. No auth (runs
    before auth, for everyone)."""
    ip = geo.client_ip(request.headers.get("X-Forwarded-For", ""),
                       request.client.host if request.client else "")
    allowed, country = geo.evaluate(ip)
    if allowed:
        return Response(status_code=200, headers={"X-Geo-Country": country or "?"})
    raise HTTPException(status_code=403, detail=f"Access from your location ({country or 'unknown'}) is not permitted")


class GeoPolicyIn(BaseModel):
    mode: str            # off | allow | deny
    countries: List[str] = []


def _require_admin(request: Request) -> Identity:
    identity = get_identity(request)
    if identity.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return identity


@app.get("/api/geo/policy")
def get_geo_policy(request: Request):
    _require_admin(request)
    return geo.load_policy()


@app.put("/api/geo/policy")
def put_geo_policy(data: GeoPolicyIn, request: Request):
    _require_admin(request)
    if data.mode not in ("off", "allow", "deny"):
        raise HTTPException(status_code=400, detail="mode must be off, allow or deny")
    return geo.save_policy({"mode": data.mode, "countries": data.countries})


@app.get("/api/apps/health")
async def apps_health(request: Request):
    """Best-effort live status of each app the user can access (for the dashboard)."""
    identity = get_identity(request)
    results = {}
    async with httpx.AsyncClient(timeout=2.5) as client:
        for a in _apps_for(identity):
            if a.get("coming_soon"):
                continue
            # An explicit per-app health URL wins; otherwise probe the internal
            # address (or the app's own URL) at /api/health.
            health_url = a.get("health") or f"{INTERNAL_URLS.get(a['key'], a['url'])}/api/health"
            try:
                r = await client.get(health_url)
                results[a["key"]] = "up" if r.status_code == 200 else "degraded"
            except Exception:
                # Externally-hosted apps (separate, firewalled boxes) can't be
                # reached from the Hub by design — don't flag them red for that.
                results[a["key"]] = "up" if a.get("external") else "down"
    return results


# Serve the dashboard SPA.
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
static_path = os.path.join(frontend_path, "static")
if os.path.isdir(frontend_path):
    if os.path.isdir(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        return FileResponse(os.path.join(frontend_path, "index.html"))

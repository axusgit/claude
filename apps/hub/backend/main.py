"""Axus Hub — central platform: dashboard, application launcher, identity surface.

Auth is delegated to the platform (Authentik forward-auth); the Hub itself only
reads the identity and shows each user the apps they're entitled to. In local dev
(AUTH_MODE=local) a synthetic identity is used so the dashboard runs standalone.
"""
import os
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from axus_auth import get_identity, Identity

PLATFORM_DOMAIN = os.getenv("PLATFORM_DOMAIN", "hub.axustechnologies.com")
AUTHENTIK_URL = os.getenv("AUTHENTIK_URL", f"https://id.{PLATFORM_DOMAIN}")

# The catalog of connected applications. Each app is gated by an Authentik
# entitlement group; admins see everything.
APP_CATALOG = [
    {"key": "support", "name": "Support", "desc": "Tickets, service desk & customer portal", "group": "app-support", "icon": "🎫"},
    {"key": "rmm", "name": "RMM", "desc": "Remote monitoring & management", "group": "app-rmm", "icon": "🖥️"},
    {"key": "accounting", "name": "Accounting", "desc": "Billing, invoicing & financials", "group": "app-accounting", "icon": "💰"},
    {"key": "engineering", "name": "Engineering", "desc": "Projects, docs & dev-ops", "group": "app-engineering", "icon": "🛠️"},
]

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
    apps = []
    for a in APP_CATALOG:
        authorized = is_admin or identity.has_group(a["group"])
        if authorized:
            apps.append({**a, "url": f"https://{a['key']}.{PLATFORM_DOMAIN}"})
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
        "admin_url": f"{AUTHENTIK_URL}/if/admin/" if identity.role == "admin" else None,
        "account_url": f"{AUTHENTIK_URL}/if/user/",
    }


@app.get("/api/apps/health")
async def apps_health(request: Request):
    """Best-effort live status of each app the user can access (for the dashboard)."""
    identity = get_identity(request)
    results = {}
    async with httpx.AsyncClient(timeout=2.5) as client:
        for a in _apps_for(identity):
            try:
                r = await client.get(f"{a['url']}/api/health")
                results[a["key"]] = "up" if r.status_code == 200 else "degraded"
            except Exception:
                results[a["key"]] = "down"
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

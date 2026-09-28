"""Axus Subcontractor Management — FastAPI app.

A peer service in the Axus platform (like Support / aesign): identity comes from
Authentik forward-auth via the shared axus_auth library; the schema is managed by
Alembic (`alembic upgrade head`), never auto-created. Reached through the Hub as
the `subcontractors` tile.

This is the Phase-1 scaffold: the data model and app skeleton are in place;
routers (directory, invite, onboarding portal, uploads, review, compliance
engine, email automation, dashboard) are added incrementally in later milestones.
"""
import os

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import app.models  # ensure all models/relationships are registered
from app.auth import get_current_user, AppUser
from app.database import get_db
from app.stats import build_summary
from app.routers import subcontractors, invite, onboarding, documents, review, agreements

app = FastAPI(title="Axus Subcontractor Management", version="0.1.0")

# Restrict cross-origin to the platform domain (and localhost for dev). The UI is
# served same-origin, so this is mainly defense-in-depth.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|([a-z0-9-]+\.)*hub\.axustechnologies\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers (added incrementally as milestones land).
app.include_router(subcontractors.router)
app.include_router(invite.router)
app.include_router(documents.router)
app.include_router(review.router)
app.include_router(agreements.router)
app.include_router(onboarding.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "subcontractors"}


@app.get("/api/me")
def me(user: AppUser = Depends(get_current_user)):
    """Identity + effective permissions, for the frontend to show/hide actions."""
    return {
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "permissions": sorted(user.permissions),
    }


@app.get("/api/summary")
def summary(db: Session = Depends(get_db)):
    """KPI feed for the Hub command center (unauthenticated at app level; reachable
    only over the internal Docker network, like the other apps' /api/summary)."""
    return build_summary(db)


# ----- static frontend (served same-origin, like the Hub/Support) -----
# Two shells, like Support: the internal staff console at /staff, and the public
# onboarding portal as the catch-all (vendors land on /onboarding/<token>).
_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
_STATIC_DIR = os.path.join(_FRONTEND_DIR, "static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}


@app.get("/staff")
def staff_console():
    page = os.path.join(_FRONTEND_DIR, "staff.html")
    if os.path.isfile(page):
        return FileResponse(page, headers=_NO_CACHE)
    return {"service": "subcontractors", "detail": "staff frontend not built yet"}


@app.get("/{full_path:path}")
def portal(full_path: str):
    index = os.path.join(_FRONTEND_DIR, "index.html")
    if os.path.isfile(index):
        return FileResponse(index, headers=_NO_CACHE)
    return {"service": "subcontractors", "detail": "portal frontend not built yet"}

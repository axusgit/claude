from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routers import auth, clients, tickets, portal, users, summary, boards, email
from app.routers import xcitium as xcitium_router
import app.models  # ensure all models/relationships are registered
import os

# The database schema is managed by Alembic migrations (`alembic upgrade head`),
# not auto-created at startup. See DEPLOY.md.

app = FastAPI(title="Axus Support", version="1.0.0")

# Restrict cross-origin to the platform domain (and localhost for dev). The UI is
# served same-origin, so this is mainly defense-in-depth.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost(:\d+)?|([a-z0-9-]+\.)*hub\.axustechnologies\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(auth.router)
app.include_router(clients.router)
app.include_router(tickets.router)
app.include_router(portal.router)
app.include_router(users.router)
app.include_router(summary.router)
app.include_router(boards.router)
app.include_router(email.router)
app.include_router(xcitium_router.router)


@app.on_event("startup")
def start_email_poller():
    """Poll the support mailbox in a background thread when Graph is configured."""
    import os, time, threading
    from app import graph, email_intake
    if not graph.is_configured():
        return
    interval = max(15, int(os.getenv("EMAIL_POLL_SECONDS", "60")))

    def loop():
        while True:
            try:
                email_intake.process_inbox()
            except Exception:
                pass
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="email-poller").start()


@app.on_event("startup")
def start_xcitium_sync():
    """Mirror the legacy Xcitium Service Desk into read-only xcitium_* tables.

    Runs an initial backfill if the mirror is empty, then an incremental sync at
    the top of every hour. Enabled only when XCITIUM_SYNC_ENABLED=1 and an API key
    is present. Read-only: nothing is written back to Xcitium.
    """
    import os
    from app import xcitium, xcitium_sync
    if os.getenv("XCITIUM_SYNC_ENABLED") != "1" or not xcitium.is_configured():
        return
    xcitium_sync.start_scheduler_thread()


@app.on_event("startup")
def start_xcitium_health_monitor():
    """Watch the Xcitium clientapi forever and email on every up<->down transition.

    Xcitium's Comodo-hosted backend fails often; this gives Andy a heads-up when it
    goes down and a recovery notice when it's back. Runs whenever the API key is
    configured -- independent of the ticket-mirror sync toggle. Disable with
    XCITIUM_HEALTH_ENABLED=0.
    """
    import os
    from app import xcitium, xcitium_health
    if os.getenv("XCITIUM_HEALTH_ENABLED", "1") != "1" or not xcitium.is_configured():
        return
    xcitium_health.start_monitor_thread()


@app.on_event("startup")
def seed_default_boards():
    """Create the default service boards once, if none exist."""
    from app.database import SessionLocal
    from app.models.board import Board
    db = SessionLocal()
    try:
        if db.query(Board).count() == 0:
            defaults = [
                ("Support", "Day-to-day support requests"),
                ("Projects", "Scheduled project & SOW work"),
                ("Accounting", "Billing & finance tickets"),
                ("Talent", "Recruiting & talent management"),
            ]
            db.add_all([Board(name=n, description=d) for n, d in defaults])
            db.commit()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Axus Support"}


# Serve the frontend (client portal) if it has been built
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
static_path = os.path.join(frontend_path, "static")
if os.path.isdir(frontend_path):
    if os.path.isdir(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.get("/staff")
    def staff_console():
        return FileResponse(os.path.join(frontend_path, "staff.html"))

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        return FileResponse(os.path.join(frontend_path, "index.html"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routers import auth, clients, tickets, portal, users
import app.models  # ensure all models/relationships are registered
import os

# The database schema is managed by Alembic migrations (`alembic upgrade head`),
# not auto-created at startup. See DEPLOY.md.

app = FastAPI(title="Axus Hub", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Axus Hub"}


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

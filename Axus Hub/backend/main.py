from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.database import engine, Base
from app.routers import auth, clients, tickets
import app.models  # ensure all models are registered
import os

# Create all database tables
Base.metadata.create_all(bind=engine)

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


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Axus Hub"}


# Serve frontend static files if they exist
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_path, "static")), name="static")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        index = os.path.join(frontend_path, "index.html")
        return FileResponse(index)

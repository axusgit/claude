from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

# Production sets DATABASE_URL to the shared Postgres instance's own
# `subcontractor` database (postgresql://axus:...@postgres/subcontractor).
# Local dev falls back to a SQLite file so the app runs with no infra.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./subcontractor_dev.db")

# SQLite (local dev) needs check_same_thread disabled so FastAPI's threadpool
# can share the connection. Postgres ignores this.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

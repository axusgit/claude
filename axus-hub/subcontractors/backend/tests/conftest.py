"""Pytest fixtures: a fresh SQLite DB migrated with Alembic + a TestClient.

Environment is configured before the app imports so DATABASE_URL, the doc
encryption key, and local auth mode are all in place.
"""
import os
import sys
import tempfile

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

os.environ.setdefault("AUTH_MODE", "local")
os.environ.setdefault("UPLOAD_DIR", tempfile.mkdtemp())
os.environ.setdefault("PORTAL_URL", "https://sub.example/onboarding")

from cryptography.fernet import Fernet  # noqa: E402
os.environ.setdefault("DOC_ENCRYPTION_KEY", Fernet.generate_key().decode())

_db = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = "sqlite:///" + _db.replace(os.sep, "/")

import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic import command  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _migrate():
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(_BACKEND, "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
    command.upgrade(cfg, "head")


@pytest.fixture()
def client():
    import main
    return TestClient(main.app)


@pytest.fixture()
def make_vendor(client):
    def _make(name, email=None, **extra):
        email = email or (name.lower().replace(" ", "") + "@example.com")
        # Create now requires the full company detail set (agreement-first flow);
        # provide sensible defaults so fixtures stay terse, overridable via **extra.
        base = {
            "legal_name": name, "email": email,
            "primary_contact_name": "Test Contact", "phone": "813-555-0100",
            "address": "1 Test St", "city": "Tampa", "state": "FL", "zip": "33626",
        }
        base.update(extra)
        r = client.post("/api/subcontractors", json=base)
        assert r.status_code == 201, r.text
        return r.json()
    return _make

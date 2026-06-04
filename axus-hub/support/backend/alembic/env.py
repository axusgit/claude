"""Alembic migration environment for Axus Hub.

Pulls the database URL and model metadata from the app itself, so migrations
target the same schema and connection the running app uses. Works against both
PostgreSQL (production) and SQLite (local dev, via batch mode).
"""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make the backend package importable (env.py lives in backend/alembic/).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Importing app.database loads .env and resolves DATABASE_URL; importing
# app.models registers every table on Base.metadata for autogenerate.
from app.database import Base, DATABASE_URL  # noqa: E402
import app.models  # noqa: E402,F401

config = context.config
config.set_main_option("sqlalchemy.url", DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=url.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

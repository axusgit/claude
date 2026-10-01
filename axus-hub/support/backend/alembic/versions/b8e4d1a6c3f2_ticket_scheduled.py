"""ticket Scheduled status + scheduled_date

Revision ID: b8e4d1a6c3f2
Revises: a7f3c2d9e4b1
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "b8e4d1a6c3f2"
down_revision = "a7f3c2d9e4b1"
branch_labels = None
depends_on = None


def upgrade():
    # Add the new enum value outside the surrounding transaction (safe on every
    # PostgreSQL version), then the date column.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'scheduled'")
    op.add_column("tickets", sa.Column("scheduled_date", sa.Date(), nullable=True))


def downgrade():
    op.drop_column("tickets", "scheduled_date")
    # PostgreSQL cannot drop a single enum value; the 'scheduled' label is left
    # in place on downgrade (harmless if unused).

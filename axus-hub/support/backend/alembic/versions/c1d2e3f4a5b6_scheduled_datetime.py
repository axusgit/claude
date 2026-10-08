"""widen ticket scheduled_date to a full date+time

Revision ID: c1d2e3f4a5b6
Revises: b8e4d1a6c3f2
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "c1d2e3f4a5b6"
down_revision = "b8e4d1a6c3f2"
branch_labels = None
depends_on = None


def upgrade():
    # Staff must now schedule a specific time of day, not just a date. Widen the
    # column from DATE to TIMESTAMP (wall-clock, no tz). Existing dates become 00:00.
    op.alter_column(
        "tickets", "scheduled_date",
        type_=sa.DateTime(),
        existing_type=sa.Date(),
        existing_nullable=True,
        postgresql_using="scheduled_date::timestamp",
    )


def downgrade():
    op.alter_column(
        "tickets", "scheduled_date",
        type_=sa.Date(),
        existing_type=sa.DateTime(),
        existing_nullable=True,
        postgresql_using="scheduled_date::date",
    )

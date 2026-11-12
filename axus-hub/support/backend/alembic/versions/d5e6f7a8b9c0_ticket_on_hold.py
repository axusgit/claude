"""ticket On hold status

Adds the 'on_hold' value to the ticketstatus enum so staff can park a ticket
that is paused (e.g. waiting on a third party / parts) without closing it.

Revision ID: d5e6f7a8b9c0
Revises: f2b3c4d5e6a7
Create Date: 2026-11-11
"""
from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "f2b3c4d5e6a7"
branch_labels = None
depends_on = None


def upgrade():
    # Add the new enum value outside the surrounding transaction (safe on every
    # PostgreSQL version). IF NOT EXISTS makes re-runs harmless.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE ticketstatus ADD VALUE IF NOT EXISTS 'on_hold'")


def downgrade():
    # PostgreSQL cannot drop a single enum value; the 'on_hold' label is left in
    # place on downgrade (harmless if unused).
    pass

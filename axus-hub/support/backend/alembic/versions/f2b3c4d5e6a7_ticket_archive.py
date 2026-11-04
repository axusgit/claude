"""ticket archive / recycle bin (soft delete)

Adds tickets.archived_at: when set, the ticket is in the Archive and hidden from
normal views, awaiting manual or automatic (retention-window) permanent deletion.

Revision ID: f2b3c4d5e6a7
Revises: e1a2b3c4d5f6
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "f2b3c4d5e6a7"
down_revision = "e1a2b3c4d5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tickets_archived_at", "tickets", ["archived_at"])


def downgrade():
    op.drop_index("ix_tickets_archived_at", table_name="tickets")
    op.drop_column("tickets", "archived_at")

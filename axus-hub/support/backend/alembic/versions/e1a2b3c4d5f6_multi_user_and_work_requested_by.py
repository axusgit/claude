"""multi-user portal accounts + ticket "work requested by"

Adds users.is_multi_user (shared portal login flag) and tickets.work_requested_by
(the person a multi-user account is opening the ticket for).

Revision ID: e1a2b3c4d5f6
Revises: c1d2e3f4a5b6
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "e1a2b3c4d5f6"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("is_multi_user", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "tickets",
        sa.Column("work_requested_by", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("tickets", "work_requested_by")
    op.drop_column("users", "is_multi_user")

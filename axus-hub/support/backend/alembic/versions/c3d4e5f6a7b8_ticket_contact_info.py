"""ticket contact address + phone (customer-provided at portal open)

Revision ID: c3d4e5f6a7b8
Revises: b2d3e4f5a6c7
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a7b8"
down_revision = "b2d3e4f5a6c7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("contact_address", sa.Text(), nullable=True))
    op.add_column("tickets", sa.Column("contact_phone", sa.String(), nullable=True))


def downgrade():
    op.drop_column("tickets", "contact_phone")
    op.drop_column("tickets", "contact_address")

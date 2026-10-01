"""ticket PO number (optional, customer-provided at portal open)

Revision ID: a7f3c2d9e4b1
Revises: d4e5f6a7b8c9
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "a7f3c2d9e4b1"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("po_number", sa.String(), nullable=True))


def downgrade():
    op.drop_column("tickets", "po_number")

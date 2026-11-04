"""ticket invoice number (staff-recorded, shown on Closed queue)

Revision ID: a1c2e3f4b5d6
Revises: f2b3c4d5e6a7
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "a1c2e3f4b5d6"
down_revision = "f2b3c4d5e6a7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("invoice_number", sa.String(), nullable=True))


def downgrade():
    op.drop_column("tickets", "invoice_number")

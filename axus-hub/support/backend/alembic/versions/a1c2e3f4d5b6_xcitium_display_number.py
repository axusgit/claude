"""xcitium ticket display_number

Store the human-facing Xcitium "Ticket Number" (e.g. 8843278) alongside the
internal ticketId, so imported tickets can show their real number as X-<number>.
Populated from a CSV export of the Xcitium ticket list (the clientapi never
returns this value).

Revision ID: a1c2e3f4d5b6
Revises: f1b2c3d4e5a6
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "a1c2e3f4d5b6"
down_revision = "f1b2c3d4e5a6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("xcitium_tickets", sa.Column("display_number", sa.String(), nullable=True))
    op.create_index("ix_xcitium_tickets_display_number", "xcitium_tickets", ["display_number"])


def downgrade():
    op.drop_index("ix_xcitium_tickets_display_number", table_name="xcitium_tickets")
    op.drop_column("xcitium_tickets", "display_number")

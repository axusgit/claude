"""xcitium mirrored-ticket tombstones (permanent local ticket deletes)

Revision ID: e5c1a9d3b740
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5c1a9d3b740'
down_revision = 'd4e9a1b6c2f8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'xcitium_ticket_tombstones',
        sa.Column('external_id', sa.Integer(), primary_key=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('xcitium_ticket_tombstones')

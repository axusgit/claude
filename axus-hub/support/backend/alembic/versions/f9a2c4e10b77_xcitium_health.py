"""xcitium clientapi health-monitor state (single-row table)

Revision ID: f9a2c4e10b77
"""
from alembic import op
import sqlalchemy as sa

revision = 'f9a2c4e10b77'
down_revision = 'c3a9d1e57f22'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'xcitium_health',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('state', sa.String(), nullable=True),
        sa.Column('since', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(), nullable=True),
        sa.Column('consecutive_fails', sa.Integer(), server_default='0'),
    )


def downgrade() -> None:
    op.drop_table('xcitium_health')

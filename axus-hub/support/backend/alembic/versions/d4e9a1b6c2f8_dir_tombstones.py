"""xcitium directory tombstones (permanent local deletes)

Revision ID: d4e9a1b6c2f8
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e9a1b6c2f8'
down_revision = 'c8b4f1e2a907'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'xcitium_dir_tombstones',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('xcitium_user_id', sa.String(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_xcitium_dir_tombstones_email', 'xcitium_dir_tombstones', ['email'], unique=True)
    op.create_index('ix_xcitium_dir_tombstones_xid', 'xcitium_dir_tombstones', ['xcitium_user_id'])


def downgrade() -> None:
    op.drop_index('ix_xcitium_dir_tombstones_xid', table_name='xcitium_dir_tombstones')
    op.drop_index('ix_xcitium_dir_tombstones_email', table_name='xcitium_dir_tombstones')
    op.drop_table('xcitium_dir_tombstones')

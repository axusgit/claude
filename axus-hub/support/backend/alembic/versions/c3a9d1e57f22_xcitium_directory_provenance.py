"""xcitium directory import: source/provenance columns on clients and users

Revision ID: c3a9d1e57f22
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3a9d1e57f22'
down_revision = 'b7f1c3d92a10'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('clients', sa.Column('source', sa.String(), server_default='native', nullable=False))
    op.add_column('users', sa.Column('source', sa.String(), server_default='native', nullable=False))
    op.add_column('users', sa.Column('xcitium_user_id', sa.String(), nullable=True))
    op.create_index('ix_users_xcitium_user_id', 'users', ['xcitium_user_id'])


def downgrade() -> None:
    op.drop_index('ix_users_xcitium_user_id', table_name='users')
    op.drop_column('users', 'xcitium_user_id')
    op.drop_column('users', 'source')
    op.drop_column('clients', 'source')

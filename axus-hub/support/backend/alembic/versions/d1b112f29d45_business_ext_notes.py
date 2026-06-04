"""business ext and notes

Revision ID: d1b112f29d45
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1b112f29d45'
down_revision = '6a0ab1325a49'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('clients', sa.Column('ext', sa.String(), nullable=True))
    op.add_column('clients', sa.Column('notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('clients', 'notes')
    op.drop_column('clients', 'ext')

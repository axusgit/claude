"""signature logo

Revision ID: 6a0ab1325a49
"""
from alembic import op
import sqlalchemy as sa

revision = '6a0ab1325a49'
down_revision = '50dcb7bf2901'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('signature_logo', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'signature_logo')

"""ticket reporter user

Revision ID: e2c45a8f1b30
"""
from alembic import op
import sqlalchemy as sa

revision = 'e2c45a8f1b30'
down_revision = 'd1b112f29d45'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('reporter_user_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('tickets', 'reporter_user_id')

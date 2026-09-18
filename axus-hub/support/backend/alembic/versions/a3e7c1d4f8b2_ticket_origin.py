"""ticket origin (where the ticket came from)

Revision ID: a3e7c1d4f8b2
"""
from alembic import op
import sqlalchemy as sa

revision = 'a3e7c1d4f8b2'
down_revision = 'f9a2c4e10b77'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('origin', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('tickets', 'origin')

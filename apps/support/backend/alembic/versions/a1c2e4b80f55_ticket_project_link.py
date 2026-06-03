"""ticket project link (parent project)

Revision ID: a1c2e4b80f55
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1c2e4b80f55'
down_revision = 'f3d7e9a21c84'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('tickets', sa.Column('project_id', sa.Integer(), nullable=True))
    op.create_index('ix_tickets_project_id', 'tickets', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_tickets_project_id', table_name='tickets')
    op.drop_column('tickets', 'project_id')

"""canned responses (staff saved replies)

Revision ID: f1b2c3d4e5a6
"""
from alembic import op
import sqlalchemy as sa

revision = 'f1b2c3d4e5a6'
down_revision = 'e5c1a9d3b740'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'canned_responses',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('canned_responses')

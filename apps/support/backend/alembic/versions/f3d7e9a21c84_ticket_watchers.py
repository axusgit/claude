"""ticket watchers (additional users)

Revision ID: f3d7e9a21c84
"""
from alembic import op
import sqlalchemy as sa

revision = 'f3d7e9a21c84'
down_revision = 'e2c45a8f1b30'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ticket_watchers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ticket_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('ticket_id', 'user_id', name='uq_ticket_watcher'),
    )
    op.create_index('ix_ticket_watchers_ticket_id', 'ticket_watchers', ['ticket_id'])


def downgrade() -> None:
    op.drop_index('ix_ticket_watchers_ticket_id', table_name='ticket_watchers')
    op.drop_table('ticket_watchers')

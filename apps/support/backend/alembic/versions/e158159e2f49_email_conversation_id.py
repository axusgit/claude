"""email conversation id

Revision ID: e158159e2f49
Revises: 09e9fa4fc419
Create Date: 2026-06-03 09:33:07.026977

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e158159e2f49'
down_revision: Union[str, None] = '09e9fa4fc419'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add the column + index only (no table rebuild / named-FK recreation).
    op.add_column('tickets', sa.Column('email_conversation_id', sa.String(), nullable=True))
    op.create_index(op.f('ix_tickets_email_conversation_id'), 'tickets', ['email_conversation_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_tickets_email_conversation_id'), table_name='tickets')
    op.drop_column('tickets', 'email_conversation_id')

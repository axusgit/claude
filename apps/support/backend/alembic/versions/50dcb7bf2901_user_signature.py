"""user signature

Revision ID: 50dcb7bf2901
Revises: e158159e2f49
Create Date: 2026-06-03 13:17:07.909252

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '50dcb7bf2901'
down_revision: Union[str, None] = 'e158159e2f49'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('signature', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'signature')

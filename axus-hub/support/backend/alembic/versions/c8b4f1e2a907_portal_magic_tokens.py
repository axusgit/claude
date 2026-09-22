"""portal magic-link sign-in tokens (passwordless customer portal)

Revision ID: c8b4f1e2a907
"""
from alembic import op
import sqlalchemy as sa

revision = 'c8b4f1e2a907'
down_revision = 'a3e7c1d4f8b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'portal_magic_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('token_hash', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_portal_magic_tokens_user_id', 'portal_magic_tokens', ['user_id'])
    op.create_index('ix_portal_magic_tokens_token_hash', 'portal_magic_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_portal_magic_tokens_token_hash', table_name='portal_magic_tokens')
    op.drop_index('ix_portal_magic_tokens_user_id', table_name='portal_magic_tokens')
    op.drop_table('portal_magic_tokens')

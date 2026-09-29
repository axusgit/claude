"""client password login: per-user/business enable, expiry, must-change, history

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("password_set_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("users", sa.Column("password_login_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("clients", sa.Column("password_login_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table(
        "client_password_history",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), index=True, nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("client_password_history")
    op.drop_column("clients", "password_login_enabled")
    op.drop_column("users", "password_login_enabled")
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "password_set_at")

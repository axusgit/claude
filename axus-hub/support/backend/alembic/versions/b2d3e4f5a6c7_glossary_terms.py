"""glossary_terms (staff-only reference)

Revision ID: b2d3e4f5a6c7
Revises: a1c2e3f4d5b6
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "b2d3e4f5a6c7"
down_revision = "a1c2e3f4d5b6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "glossary_terms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("term", sa.String(), nullable=False),
        sa.Column("definition", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_glossary_terms_term", "glossary_terms", ["term"])


def downgrade():
    op.drop_index("ix_glossary_terms_term", table_name="glossary_terms")
    op.drop_table("glossary_terms")

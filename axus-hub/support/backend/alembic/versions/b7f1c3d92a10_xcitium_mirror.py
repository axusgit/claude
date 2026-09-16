"""xcitium mirror tables (read-only import from Xcitium Service Desk)

Revision ID: b7f1c3d92a10
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7f1c3d92a10'
down_revision = 'a1c2e4b80f55'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'xcitium_customers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_xcitium_customers_name', 'xcitium_customers', ['name'], unique=True)

    op.create_table(
        'xcitium_users',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('external_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('organization_name', sa.String(), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_xcitium_users_external_id', 'xcitium_users', ['external_id'], unique=True)
    op.create_index('ix_xcitium_users_email', 'xcitium_users', ['email'])
    op.create_index('ix_xcitium_users_organization_name', 'xcitium_users', ['organization_name'])

    op.create_table(
        'xcitium_tickets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('external_id', sa.Integer(), nullable=False),
        sa.Column('subject', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('priority', sa.String(), nullable=True),
        sa.Column('department', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('asset', sa.String(), nullable=True),
        sa.Column('device_name', sa.String(), nullable=True),
        sa.Column('assignee', sa.String(), nullable=True),
        sa.Column('username', sa.String(), nullable=True),
        sa.Column('user_external_id', sa.String(), nullable=True),
        sa.Column('user_email', sa.String(), nullable=True),
        sa.Column('organization_name', sa.String(), nullable=True),
        sa.Column('create_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('update_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_message', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_response', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_resolution', sa.String(), nullable=True),
        sa.Column('thread_count', sa.Integer(), server_default='0'),
        sa.Column('raw_json', sa.Text(), nullable=True),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_xcitium_tickets_external_id', 'xcitium_tickets', ['external_id'], unique=True)
    op.create_index('ix_xcitium_tickets_status', 'xcitium_tickets', ['status'])
    op.create_index('ix_xcitium_tickets_department', 'xcitium_tickets', ['department'])
    op.create_index('ix_xcitium_tickets_user_external_id', 'xcitium_tickets', ['user_external_id'])
    op.create_index('ix_xcitium_tickets_organization_name', 'xcitium_tickets', ['organization_name'])

    op.create_table(
        'xcitium_threads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('ticket_external_id', sa.Integer(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('created', sa.DateTime(timezone=True), nullable=True),
        sa.Column('poster', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
    )
    op.create_index('ix_xcitium_threads_ticket_external_id', 'xcitium_threads', ['ticket_external_id'])
    op.create_index('ix_xcitium_threads_ticket_seq', 'xcitium_threads',
                    ['ticket_external_id', 'seq'])

    op.create_table(
        'xcitium_sync_state',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('max_ticket_id', sa.Integer(), server_default='0'),
        sa.Column('high_water_id', sa.Integer(), server_default='0'),
        sa.Column('tickets_total', sa.Integer(), server_default='0'),
        sa.Column('running', sa.Boolean(), server_default=sa.false()),
        sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_run_status', sa.String(), nullable=True),
        sa.Column('last_full_backfill_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('xcitium_sync_state')
    op.drop_index('ix_xcitium_threads_ticket_seq', table_name='xcitium_threads')
    op.drop_index('ix_xcitium_threads_ticket_external_id', table_name='xcitium_threads')
    op.drop_table('xcitium_threads')
    op.drop_index('ix_xcitium_tickets_organization_name', table_name='xcitium_tickets')
    op.drop_index('ix_xcitium_tickets_user_external_id', table_name='xcitium_tickets')
    op.drop_index('ix_xcitium_tickets_department', table_name='xcitium_tickets')
    op.drop_index('ix_xcitium_tickets_status', table_name='xcitium_tickets')
    op.drop_index('ix_xcitium_tickets_external_id', table_name='xcitium_tickets')
    op.drop_table('xcitium_tickets')
    op.drop_index('ix_xcitium_users_organization_name', table_name='xcitium_users')
    op.drop_index('ix_xcitium_users_email', table_name='xcitium_users')
    op.drop_index('ix_xcitium_users_external_id', table_name='xcitium_users')
    op.drop_table('xcitium_users')
    op.drop_index('ix_xcitium_customers_name', table_name='xcitium_customers')
    op.drop_table('xcitium_customers')

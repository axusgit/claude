"""initial subcontractor management schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-28

Creates the full Subcontractor Management data model. Agreement/version/signature
tables are intentionally absent — e-signature is owned by the aesign service; we
store only a pointer (agreement_links).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subcontractors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(), nullable=True),
        sa.Column("legal_name", sa.String(), nullable=False),
        sa.Column("dba", sa.String(), nullable=True),
        sa.Column("primary_contact_name", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("zip", sa.String(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("services_provided", sa.Text(), nullable=True),
        sa.Column("geographic_coverage", sa.Text(), nullable=True),
        sa.Column("vendor_status", sa.String(), nullable=False, server_default="invited"),
        sa.Column("compliance_status", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("compliance_override", sa.String(), nullable=True),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("override_by", sa.String(), nullable=True),
        sa.Column("override_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("w9_status", sa.String(), nullable=False, server_default="missing"),
        sa.Column("coi_status", sa.String(), nullable=False, server_default="missing"),
        sa.Column("coi_expiration_date", sa.Date(), nullable=True),
        sa.Column("agreement_status", sa.String(), nullable=False, server_default="missing"),
        sa.Column("agreement_signed_date", sa.Date(), nullable=True),
        sa.Column("agreement_renewal_date", sa.Date(), nullable=True),
        sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_subcontractors_public_id", "subcontractors", ["public_id"], unique=True)
    op.create_index("ix_subcontractors_legal_name", "subcontractors", ["legal_name"])
    op.create_index("ix_subcontractors_email", "subcontractors", ["email"])
    op.create_index("ix_subcontractors_state", "subcontractors", ["state"])
    op.create_index("ix_subcontractors_vendor_status", "subcontractors", ["vendor_status"])
    op.create_index("ix_subcontractors_compliance_status", "subcontractors", ["compliance_status"])

    op.create_table(
        "subcontractor_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_subcontractor_contacts_subcontractor_id", "subcontractor_contacts", ["subcontractor_id"])

    op.create_table(
        "subcontractor_services",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_subcontractor_services_subcontractor_id", "subcontractor_services", ["subcontractor_id"])
    op.create_index("ix_subcontractor_services_name", "subcontractor_services", ["name"])

    op.create_table(
        "subcontractor_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("doc_type", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending_review"),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("stored_name", sa.String(), nullable=False),
        sa.Column("original_filename", sa.String(), nullable=True),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("uploaded_by", sa.String(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("reviewed_by", sa.String(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_subcontractor_documents_subcontractor_id", "subcontractor_documents", ["subcontractor_id"])
    op.create_index("ix_subcontractor_documents_doc_type", "subcontractor_documents", ["doc_type"])
    op.create_index("ix_subcontractor_documents_status", "subcontractor_documents", ["status"])
    op.create_index("ix_subcontractor_documents_expiration_date", "subcontractor_documents", ["expiration_date"])

    op.create_table(
        "onboarding_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_onboarding_tokens_token_hash", "onboarding_tokens", ["token_hash"], unique=True)
    op.create_index("ix_onboarding_tokens_subcontractor_id", "onboarding_tokens", ["subcontractor_id"])

    op.create_table(
        "document_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("request_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("request_created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("first_notification_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_notification_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_notification_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_document_requests_subcontractor_id", "document_requests", ["subcontractor_id"])
    op.create_index("ix_document_requests_request_type", "document_requests", ["request_type"])
    op.create_index("ix_document_requests_status", "document_requests", ["status"])
    op.create_index("ix_document_requests_next_notification_at", "document_requests", ["next_notification_at"])

    op.create_table(
        "email_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=True),
        sa.Column("request_id", sa.Integer(), sa.ForeignKey("document_requests.id"), nullable=True),
        sa.Column("recipient", sa.String(), nullable=False),
        sa.Column("email_type", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="sent"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_email_log_subcontractor_id", "email_log", ["subcontractor_id"])
    op.create_index("ix_email_log_request_id", "email_log", ["request_id"])
    op.create_index("ix_email_log_email_type", "email_log", ["email_type"])

    op.create_table(
        "subcontractor_activities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=True),
        sa.Column("actor", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("previous_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_subcontractor_activities_subcontractor_id", "subcontractor_activities", ["subcontractor_id"])
    op.create_index("ix_subcontractor_activities_action", "subcontractor_activities", ["action"])

    op.create_table(
        "subcontractor_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("author", sa.String(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_subcontractor_notes_subcontractor_id", "subcontractor_notes", ["subcontractor_id"])

    op.create_table(
        "agreement_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subcontractor_id", sa.Integer(), sa.ForeignKey("subcontractors.id"), nullable=False),
        sa.Column("envelope_id", sa.String(), nullable=True),
        sa.Column("agreement_version", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="sent"),
        sa.Column("sha256", sa.String(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("renewal_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_agreement_links_subcontractor_id", "agreement_links", ["subcontractor_id"])
    op.create_index("ix_agreement_links_envelope_id", "agreement_links", ["envelope_id"])
    op.create_index("ix_agreement_links_status", "agreement_links", ["status"])

    op.create_table(
        "compliance_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("coi_advance_notice_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("reminder_interval_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("agreement_renewal_months", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("agreement_advance_notice_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("notification_recipients", sa.Text(), nullable=True,
                  server_default="info@axustechnologies.com"),
        sa.Column("additional_insured_name", sa.String(), nullable=True,
                  server_default="Axus Technologies"),
        sa.Column("additional_insured_address", sa.Text(), nullable=True,
                  server_default="13046 Racetrack Rd., Suite 255, Tampa, FL 33626"),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("compliance_config")
    op.drop_table("agreement_links")
    op.drop_table("subcontractor_notes")
    op.drop_table("subcontractor_activities")
    op.drop_table("email_log")
    op.drop_table("document_requests")
    op.drop_table("onboarding_tokens")
    op.drop_table("subcontractor_documents")
    op.drop_table("subcontractor_services")
    op.drop_table("subcontractor_contacts")
    op.drop_table("subcontractors")

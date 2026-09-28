"""Import every model so relationships register on Base.metadata (for Alembic)."""
from app.models.subcontractor import Subcontractor
from app.models.contact import SubcontractorContact
from app.models.service import SubcontractorService
from app.models.document import SubcontractorDocument
from app.models.onboarding_token import OnboardingToken
from app.models.document_request import DocumentRequest
from app.models.email_log import EmailLog
from app.models.activity import SubcontractorActivity
from app.models.note import SubcontractorNote
from app.models.agreement_link import AgreementLink
from app.models.config import ComplianceConfig

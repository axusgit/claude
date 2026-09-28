"""Pydantic request/response schemas for the staff API."""
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


class SubcontractorCreate(BaseModel):
    # Minimum to add a vendor (spec §ADD/INVITE); the rest is optional up front.
    legal_name: str
    primary_contact_name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    dba: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    website: Optional[str] = None
    services_provided: Optional[str] = None
    geographic_coverage: Optional[str] = None


class SubcontractorUpdate(BaseModel):
    legal_name: Optional[str] = None
    dba: Optional[str] = None
    primary_contact_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    website: Optional[str] = None
    services_provided: Optional[str] = None
    geographic_coverage: Optional[str] = None


class SubcontractorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str]
    legal_name: str
    dba: Optional[str]
    primary_contact_name: Optional[str]
    email: str
    phone: Optional[str]
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]
    website: Optional[str]
    services_provided: Optional[str]
    geographic_coverage: Optional[str]
    vendor_status: str
    compliance_status: str
    compliance_override: Optional[str]
    w9_status: str
    coi_status: str
    coi_expiration_date: Optional[date]
    agreement_status: str
    agreement_signed_date: Optional[date]
    agreement_renewal_date: Optional[date]
    last_contact_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: Optional[str]
    phone: Optional[str]
    title: Optional[str]
    is_primary: bool


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    actor: Optional[str]
    action: str
    detail: Optional[str]
    created_at: Optional[datetime]


class SubcontractorDetail(SubcontractorOut):
    contacts: List[ContactOut] = []
    services: List[ServiceOut] = []
    recent_activity: List[ActivityOut] = []


class OnboardingCompanyUpdate(BaseModel):
    """Fields a subcontractor may edit from the public portal (no status fields)."""
    legal_name: Optional[str] = None
    dba: Optional[str] = None
    primary_contact_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    website: Optional[str] = None
    services_provided: Optional[str] = None
    geographic_coverage: Optional[str] = None


class DocumentReview(BaseModel):
    action: str          # "approve" | "reject"
    reason: Optional[str] = None
    effective_date: Optional[date] = None
    expiration_date: Optional[date] = None


class VendorReview(BaseModel):
    action: str          # approve | reject | request_correction | hold | inactive
    reason: Optional[str] = None

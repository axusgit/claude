from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.client import Client
from app.models.contact import Contact
from app.models.user import User, UserRole
from app.auth import get_current_user, hash_password
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/clients", tags=["clients"])


class ClientIn(BaseModel):
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    is_active: bool = True


class ClientOut(BaseModel):
    id: int
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str]
    website: Optional[str]
    address: Optional[str]
    is_active: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ClientOut])
def list_clients(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Client).filter(Client.is_active == True).order_by(Client.company_name).all()


@router.post("/", response_model=ClientOut)
def create_client(data: ClientIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    client = Client(**data.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, data: ClientIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    for key, value in data.model_dump().items():
        setattr(client, key, value)
    db.commit()
    db.refresh(client)
    return client


class PortalUserIn(BaseModel):
    email: EmailStr
    full_name: str
    password: str


class PortalUserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    client_id: Optional[int]

    class Config:
        from_attributes = True


@router.post("/{client_id}/portal-users", response_model=PortalUserOut)
def create_portal_user(
    client_id: int,
    data: PortalUserIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Provision a client-portal login tied to a specific client company."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=UserRole.client,
        client_id=client_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{client_id}/portal-users", response_model=List[PortalUserOut])
def list_portal_users(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List the portal logins associated with a customer."""
    return (
        db.query(User)
        .filter(User.client_id == client_id, User.role == UserRole.client)
        .order_by(User.full_name)
        .all()
    )


# ----- Contacts (people who belong to a customer) -----

class ContactIn(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    client_id: int
    full_name: str
    email: Optional[str]
    phone: Optional[str]
    title: Optional[str]

    class Config:
        from_attributes = True


def _get_client_or_404(client_id: int, db: Session) -> Client:
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.get("/{client_id}/contacts", response_model=List[ContactOut])
def list_contacts(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return (
        db.query(Contact)
        .filter(Contact.client_id == client_id)
        .order_by(Contact.full_name)
        .all()
    )


@router.post("/{client_id}/contacts", response_model=ContactOut)
def create_contact(client_id: int, data: ContactIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    _get_client_or_404(client_id, db)
    contact = Contact(client_id=client_id, **data.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.put("/{client_id}/contacts/{contact_id}", response_model=ContactOut)
def update_contact(client_id: int, contact_id: int, data: ContactIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.client_id == client_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for key, value in data.model_dump().items():
        setattr(contact, key, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{client_id}/contacts/{contact_id}")
def delete_contact(client_id: int, contact_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    contact = db.query(Contact).filter(Contact.id == contact_id, Contact.client_id == client_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"status": "deleted", "id": contact_id}

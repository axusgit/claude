from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models.client import Client
from app.models.contact import Contact
from app.models.user import User, UserRole
from app.models.ticket import Ticket
from app.models.invoice import Invoice
from app.auth import get_current_user, hash_password, require_admin, require_staff
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/clients", tags=["clients"])


class ClientIn(BaseModel):
    company_name: str                       # Business Name
    location: Optional[str] = None          # stored in clients.address
    phone: Optional[str] = None
    ext: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True


class ClientOut(BaseModel):
    id: int
    company_name: str
    location: Optional[str]
    phone: Optional[str]
    ext: Optional[str]
    website: Optional[str]
    notes: Optional[str]
    is_active: bool
    password_login_enabled: bool = False
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ClientOut])
def list_clients(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Client).filter(Client.is_active == True).order_by(Client.company_name).all()


def _apply_business(client: Client, data: ClientIn) -> None:
    client.company_name = data.company_name
    client.address = data.location        # "Location" maps to the address column
    client.phone = data.phone
    client.ext = data.ext
    client.website = data.website
    client.notes = data.notes
    client.is_active = data.is_active


@router.post("/", response_model=ClientOut)
def create_client(data: ClientIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    client = Client(contact_name="", email="")
    _apply_business(client, data)
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
    _apply_business(client, data)
    db.commit()
    db.refresh(client)
    return client


# Businesses the system itself relies on (hidden-user holding business, the
# email-intake catch-all). Deleting them would just get them re-created.
PROTECTED_BUSINESSES = {"Dummy Business", "Unmatched Senders"}


def _business_refs(db: Session, cid: int) -> dict:
    return {
        "tickets": db.query(Ticket).filter(Ticket.client_id == cid).count(),
        "users": db.query(User).filter(User.client_id == cid).count(),
        "invoices": db.query(Invoice).filter(Invoice.client_id == cid).count(),
    }


@router.delete("/{client_id}")
def delete_client(client_id: int, transfer_to: Optional[int] = None,
                  db: Session = Depends(get_db), _=Depends(require_admin)):
    """Delete a business. A business with tickets, users or invoices can only be
    deleted once they are moved to another active business (pass
    ?transfer_to=<id>); we return 409 to prompt for a target when one is needed.
    Contacts move with it when transferring, otherwise they are deleted."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Business not found")
    if client.company_name in PROTECTED_BUSINESSES:
        raise HTTPException(status_code=400, detail=f"\"{client.company_name}\" is a system business and can't be deleted.")

    refs = _business_refs(db, client.id)
    moved = sum(refs.values())
    target = None
    if moved:
        if not transfer_to:
            parts = [f"{n} {k[:-1] if n == 1 else k}" for k, n in refs.items() if n]
            raise HTTPException(status_code=409, detail=f"{client.company_name} has {', '.join(parts)}. "
                                "Choose another business to move them to.")
        target = db.query(Client).filter(Client.id == transfer_to, Client.is_active == True).first()  # noqa: E712
        if not target or target.id == client.id:
            raise HTTPException(status_code=400, detail="Pick a valid active business to move them to.")
        for model in (Ticket, User, Invoice, Contact):
            db.query(model).filter(model.client_id == client.id).update(
                {model.client_id: target.id}, synchronize_session=False)
    else:
        db.query(Contact).filter(Contact.client_id == client.id).delete(synchronize_session=False)

    db.delete(client)
    db.commit()
    return {"status": "deleted", "id": client_id, "moved": refs if moved else {},
            "transferred_to": target.id if target else None}


class PortalUserIn(BaseModel):
    email: EmailStr
    full_name: str
    password: Optional[str] = None   # unused: portal users sign in via magic link


class PortalUserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    client_id: Optional[int]
    password_login_enabled: bool = False
    has_password: bool = False
    must_change_password: bool = False

    class Config:
        from_attributes = True

    @classmethod
    def from_user(cls, u: User):
        return cls(
            id=u.id, email=u.email, full_name=u.full_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            client_id=u.client_id,
            password_login_enabled=bool(getattr(u, "password_login_enabled", False)),
            has_password=bool(u.hashed_password),
            must_change_password=bool(getattr(u, "must_change_password", False)),
        )


@router.post("/{client_id}/portal-users", response_model=PortalUserOut)
def create_portal_user(
    client_id: int,
    data: PortalUserIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
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
        hashed_password=hash_password(data.password) if data.password else "",
        role=UserRole.client,
        client_id=client_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return PortalUserOut.from_user(user)


@router.get("/{client_id}/portal-users", response_model=List[PortalUserOut])
def list_portal_users(client_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """List the portal logins associated with a customer."""
    rows = (
        db.query(User)
        .filter(User.client_id == client_id, User.role == UserRole.client)
        .order_by(User.full_name)
        .all()
    )
    return [PortalUserOut.from_user(u) for u in rows]


class PasswordResetIn(BaseModel):
    password: str


def _get_portal_user(client_id: int, user_id: int, db: Session) -> User:
    user = (db.query(User)
            .filter(User.id == user_id, User.client_id == client_id, User.role == UserRole.client)
            .first())
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return user


@router.put("/{client_id}/portal-users/{user_id}/password", response_model=PortalUserOut)
def reset_portal_password(
    client_id: int,
    user_id: int,
    data: PasswordResetIn,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Staff set an INITIAL or RESET temp password for a client user. The user is
    forced to choose a new policy-compliant password at their next login."""
    from app import password_policy as pwpolicy
    new_pw = (data.password or "").strip()
    if len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = _get_portal_user(client_id, user_id, db)
    pwpolicy.record_password(db, user, new_pw)   # sets hash + history + password_set_at
    user.must_change_password = True             # force change on next login
    db.commit()
    db.refresh(user)
    return PortalUserOut.from_user(user)


class ToggleIn(BaseModel):
    enabled: bool


@router.put("/{client_id}/password-login", response_model=ClientOut)
def set_business_password_login(client_id: int, data: ToggleIn,
                                db: Session = Depends(get_db), _=Depends(require_staff)):
    """All-or-nothing business-level password-login capability. When ON, every
    user under the business inherits it (their per-user box shows checked +
    read-only in the UI); the effective check ORs business + per-user."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.password_login_enabled = bool(data.enabled)
    db.commit()
    db.refresh(client)
    return client


@router.put("/{client_id}/portal-users/{user_id}/password-login", response_model=PortalUserOut)
def set_user_password_login(client_id: int, user_id: int, data: ToggleIn,
                            db: Session = Depends(get_db), _=Depends(require_staff)):
    """Per-user password-login capability (used when the business toggle is OFF)."""
    user = _get_portal_user(client_id, user_id, db)
    user.password_login_enabled = bool(data.enabled)
    db.commit()
    db.refresh(user)
    return PortalUserOut.from_user(user)


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

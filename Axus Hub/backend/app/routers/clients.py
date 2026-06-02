from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.client import Client
from app.models.user import User, UserRole
from app.auth import get_current_user, hash_password
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/clients", tags=["clients"])


class ClientIn(BaseModel):
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    address: Optional[str] = None


class ClientOut(BaseModel):
    id: int
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str]
    address: Optional[str]
    is_active: bool

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

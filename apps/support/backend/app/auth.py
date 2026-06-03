"""Support authentication.

Two modes (selected by AUTH_MODE, default "local"):
  * central — trust the identity injected by the Authentik forward-auth outpost
              (production behind Traefik). Users are auto-provisioned/synced from
              the IdP; no local passwords.
  * local   — the legacy bcrypt + JWT login, for running standalone without the
              platform IdP (local dev / fallback).
"""
import os
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from axus_auth import get_identity, AUTH_MODE
from app.database import get_db
from app.models.user import User

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 480))

# Authentik passes a client company id for portal users via this header
# (property mapping); local dev can set DEV_USER_CLIENT_ID instead.
CLIENT_ID_HEADER = "X-Axus-Client-Id"
SUPPORT_ROLES = {"admin", "technician", "client"}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ----- password / token helpers (local mode only) -----

def _pw_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:72]  # bcrypt's 72-byte limit


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_pw_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return bcrypt.checkpw(_pw_bytes(plain), hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    payload = data.copy()
    if "sub" in payload:
        payload["sub"] = str(payload["sub"])
    payload["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ----- central mode: provision/sync the local user from the platform identity -----

def _provision_from_identity(request: Request, db: Session) -> User:
    identity = get_identity(request)  # 401 if the request didn't pass the IdP
    role = identity.role if identity.role in SUPPORT_ROLES else "technician"
    raw_cid = request.headers.get(CLIENT_ID_HEADER) or os.getenv("DEV_USER_CLIENT_ID")
    client_id = int(raw_cid) if raw_cid and str(raw_cid).isdigit() else None

    user = db.query(User).filter(User.email == identity.email).first()
    if user is None:
        user = User(
            email=identity.email,
            full_name=identity.name or identity.email,
            hashed_password="",  # central users never log in with a local password
            role=role,
            client_id=client_id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    # keep the local record in sync with the IdP
    dirty = False
    if identity.name and user.full_name != identity.name:
        user.full_name = identity.name; dirty = True
    if user.role != role:
        user.role = role; dirty = True
    if client_id is not None and user.client_id != client_id:
        user.client_id = client_id; dirty = True
    if dirty:
        db.commit(); db.refresh(user)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


# ----- local mode: JWT -----

def _user_from_jwt(token: str, db: Session) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise credentials_exception
        user_id = int(sub)
    except (JWTError, ValueError):
        raise credentials_exception
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_exception
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(oauth2_scheme),
) -> User:
    if AUTH_MODE == "central":
        return _provision_from_identity(request, db)
    return _user_from_jwt(token, db)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

"""Central identity for Axus platform apps.

In production, the Authentik forward-auth outpost (in front of every app via
Traefik) authenticates the request and injects trusted identity headers. Apps
read them here instead of running their own login.

In local dev (``AUTH_MODE=local``) an identity is synthesized from env vars so
an app runs standalone without the IdP.
"""
import os
from dataclasses import dataclass, field
from typing import List

from fastapi import Depends, HTTPException, Request

# Headers injected by Authentik's proxy / forward-auth outpost.
H_EMAIL = "X-authentik-email"
H_USERNAME = "X-authentik-username"
H_NAME = "X-authentik-name"
H_GROUPS = "X-authentik-groups"  # separated by "|" or ","

# "central" trusts the forward-auth headers; "local" uses the dev fallback.
# Defaults to "local" so apps run standalone; production sets AUTH_MODE=central.
AUTH_MODE = os.getenv("AUTH_MODE", "local")

# Role groups in descending privilege; the highest one the user holds wins.
_ROLE_ORDER = ["admin", "finance", "engineer", "technician", "client"]


@dataclass
class Identity:
    email: str
    username: str
    name: str
    groups: List[str] = field(default_factory=list)

    def has_group(self, group: str) -> bool:
        return group in self.groups

    @property
    def role(self) -> str:
        for r in _ROLE_ORDER:
            if f"role-{r}" in self.groups:
                return r
        return "technician"


def _split_groups(raw: str) -> List[str]:
    if not raw:
        return []
    sep = "|" if "|" in raw else ","
    return [g.strip() for g in raw.split(sep) if g.strip()]


def get_identity(request: Request) -> Identity:
    """FastAPI dependency: the authenticated platform identity for this request."""
    if AUTH_MODE == "local":
        return Identity(
            email=os.getenv("DEV_USER_EMAIL", "dev@axustechnologies.com"),
            username=os.getenv("DEV_USER_NAME", "dev"),
            name=os.getenv("DEV_USER_NAME", "Dev User"),
            groups=_split_groups(os.getenv("DEV_USER_GROUPS", "role-admin|app-hub|app-support")),
        )
    email = request.headers.get(H_EMAIL)
    if not email:
        # Forward-auth guarantees this header; its absence means the request
        # did not pass through the Authentik outpost.
        raise HTTPException(status_code=401, detail="No authenticated identity")
    return Identity(
        email=email,
        username=request.headers.get(H_USERNAME, email),
        name=request.headers.get(H_NAME, email),
        groups=_split_groups(request.headers.get(H_GROUPS, "")),
    )


def require_group(group: str):
    """Dependency factory enforcing membership of an entitlement group (e.g. app-support)."""
    def _dep(identity: Identity = Depends(get_identity)) -> Identity:
        if not identity.has_group(group):
            raise HTTPException(status_code=403, detail=f"Access to '{group}' is required")
        return identity
    return _dep

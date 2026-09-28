"""Authentication & authorization for Subcontractor Management.

Identity is supplied by the platform (Authentik forward-auth headers, read via
the shared `axus_auth` library). In local dev (`AUTH_MODE=local`, the default),
`axus_auth` synthesizes an admin identity so the app runs without the IdP.

Unlike Support, this app keeps NO local users table: staff are transient
identities from the IdP, and audit rows record the actor's email string
directly (the same approach aesign uses). Access to the app as a whole is gated
by Traefik on the `app-subcontractors` Authentik group; the fine-grained
permissions below are enforced in-app per action.

Sensitive-document access (W-9) is a distinct permission (P_VIEW_W9) so that not
every user who can see the directory can open tax documents.
"""
from dataclasses import dataclass, field
from typing import Set

from fastapi import Depends, HTTPException, Request

from axus_auth import get_identity

APP_GROUP = "app-subcontractors"

# In-app roles
ROLE_ADMIN = "admin"
ROLE_REVIEWER = "reviewer"
ROLE_VIEWER = "viewer"

# Granular permissions (spec §PERMISSIONS)
P_VIEW = "view_subcontractors"
P_CREATE = "create_subcontractors"
P_EDIT = "edit_subcontractors"
P_INVITE = "invite_subcontractors"
P_REVIEW_DOCS = "review_compliance_documents"
P_VIEW_W9 = "access_w9_documents"
P_APPROVE = "approve_subcontractors"
P_MANAGE_AGREEMENTS = "manage_agreements"
P_OVERRIDE = "override_compliance_status"
P_DEACTIVATE = "deactivate_subcontractors"
P_ADMIN_CONFIG = "admin_configuration"

_REVIEWER_PERMS = {
    P_VIEW, P_CREATE, P_EDIT, P_INVITE, P_REVIEW_DOCS, P_VIEW_W9,
    P_APPROVE, P_MANAGE_AGREEMENTS,
}

# Admin gets every permission.
_ALL_PERMS = _REVIEWER_PERMS | {P_OVERRIDE, P_DEACTIVATE, P_ADMIN_CONFIG}

ROLE_PERMISSIONS = {
    ROLE_ADMIN: _ALL_PERMS,
    ROLE_REVIEWER: _REVIEWER_PERMS,
    ROLE_VIEWER: {P_VIEW},
}


@dataclass
class AppUser:
    email: str
    name: str
    role: str
    permissions: Set[str] = field(default_factory=set)

    def can(self, perm: str) -> bool:
        return perm in self.permissions


def _app_role(platform_role: str) -> str:
    """Map the platform role-* group to this app's role.

    Provisional mapping (refine once the reviewer roster is decided):
      role-admin       -> admin
      role-technician  -> reviewer
      everything else  -> viewer
    """
    if platform_role == "admin":
        return ROLE_ADMIN
    if platform_role == "technician":
        return ROLE_REVIEWER
    return ROLE_VIEWER


def get_current_user(request: Request) -> AppUser:
    identity = get_identity(request)  # raises 401 if the request didn't pass the IdP
    role = _app_role(identity.role)
    return AppUser(
        email=identity.email,
        name=identity.name or identity.email,
        role=role,
        permissions=set(ROLE_PERMISSIONS.get(role, set())),
    )


def require_staff(user: AppUser = Depends(get_current_user)) -> AppUser:
    """Any authenticated staff member with at least read access."""
    if not user.can(P_VIEW):
        raise HTTPException(status_code=403, detail="Access denied")
    return user


def require_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    if user.role != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_permission(perm: str):
    """Dependency factory: gate a route on a specific granular permission."""
    def _dep(user: AppUser = Depends(get_current_user)) -> AppUser:
        if not user.can(perm):
            raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")
        return user
    return _dep

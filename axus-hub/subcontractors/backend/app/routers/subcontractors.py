"""Staff API: the subcontractor directory (list / create / detail / update) + stats.

All routes require staff identity; write actions require the matching granular
permission. Every mutation writes an audit row. Records are assigned a permanent
AXV-###### public id on create. Soft-deleted (tombstoned) rows are excluded.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    AppUser, require_staff, require_permission,
    P_CREATE, P_EDIT,
)
from app.activity import log_activity
from app.ids import format_public_id
from app.stats import compute_stats
from app.models.subcontractor import Subcontractor
from app.schemas import (
    SubcontractorCreate, SubcontractorUpdate, SubcontractorOut, SubcontractorDetail,
    ActivityOut,
)

router = APIRouter(prefix="/api/subcontractors", tags=["subcontractors"])

# Fields a staff editor may change directly (audited).
_EDITABLE = [
    "legal_name", "dba", "primary_contact_name", "email", "phone", "address",
    "city", "state", "zip", "website", "services_provided", "geographic_coverage",
]


@router.get("", response_model=List[SubcontractorOut])
def list_subcontractors(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_staff),
    q: Optional[str] = Query(None, description="search company / contact / email / phone / city"),
    status: Optional[str] = Query(None, description="vendor_status filter"),
    state: Optional[str] = None,
    service: Optional[str] = Query(None, description="service name contains"),
):
    query = db.query(Subcontractor).filter(Subcontractor.deleted_at.is_(None))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            Subcontractor.legal_name.ilike(like),
            Subcontractor.dba.ilike(like),
            Subcontractor.primary_contact_name.ilike(like),
            Subcontractor.email.ilike(like),
            Subcontractor.phone.ilike(like),
            Subcontractor.city.ilike(like),
        ))
    if status:
        query = query.filter(Subcontractor.vendor_status == status)
    if state:
        query = query.filter(Subcontractor.state == state)
    if service:
        query = query.filter(Subcontractor.services_provided.ilike(f"%{service}%"))
    # Default directory sort: company name A -> Z (spec).
    return query.order_by(Subcontractor.legal_name.asc()).all()


@router.get("/stats")
def stats(db: Session = Depends(get_db), _: AppUser = Depends(require_staff)):
    return compute_stats(db)


@router.post("", response_model=SubcontractorDetail, status_code=201)
def create_subcontractor(
    payload: SubcontractorCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_permission(P_CREATE)),
):
    sub = Subcontractor(vendor_status="onboarding", **payload.model_dump())
    db.add(sub)
    db.flush()  # assign PK so we can derive the permanent public id
    sub.public_id = format_public_id(sub.id)
    log_activity(db, sub.id, user.email, "created",
                 detail=f"Subcontractor created: {sub.legal_name} ({sub.public_id})")
    db.commit()
    db.refresh(sub)
    return _detail(sub)


@router.get("/{sub_id}", response_model=SubcontractorDetail)
def get_subcontractor(
    sub_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_staff),
):
    sub = _get_or_404(db, sub_id)
    return _detail(sub)


@router.patch("/{sub_id}", response_model=SubcontractorDetail)
def update_subcontractor(
    sub_id: int,
    payload: SubcontractorUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_permission(P_EDIT)),
):
    sub = _get_or_404(db, sub_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, new in changes.items():
        if field not in _EDITABLE:
            continue
        old = getattr(sub, field)
        if old != new:
            setattr(sub, field, new)
            log_activity(db, sub.id, user.email, "field_updated",
                         detail=f"{field} changed",
                         previous_value=str(old) if old is not None else None,
                         new_value=str(new) if new is not None else None)
    db.commit()
    db.refresh(sub)
    return _detail(sub)


# ----- helpers -----

def _get_or_404(db: Session, sub_id: int) -> Subcontractor:
    sub = db.query(Subcontractor).filter(
        Subcontractor.id == sub_id, Subcontractor.deleted_at.is_(None)
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    return sub


def _detail(sub: Subcontractor) -> SubcontractorDetail:
    d = SubcontractorDetail.model_validate(sub)  # contacts/services fill from ORM
    # newest 20 activity rows, most-recent first
    recent = sorted(sub.activities, key=lambda a: a.id, reverse=True)[:20]
    d.recent_activity = [ActivityOut.model_validate(a) for a in recent]
    return d

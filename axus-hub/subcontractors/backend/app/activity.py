"""Audit-trail helper (mirrors Support's _log_activity).

Records an entry against a subcontractor. `actor` is the staff email (None for
automated/system events). The caller commits unless commit=True.
"""
from typing import Optional
from sqlalchemy.orm import Session

from app.models.activity import SubcontractorActivity


def log_activity(
    db: Session,
    subcontractor_id: Optional[int],
    actor: Optional[str],
    action: str,
    detail: Optional[str] = None,
    previous_value: Optional[str] = None,
    new_value: Optional[str] = None,
    commit: bool = False,
) -> SubcontractorActivity:
    row = SubcontractorActivity(
        subcontractor_id=subcontractor_id,
        actor=actor,
        action=action,
        detail=detail,
        previous_value=previous_value,
        new_value=new_value,
    )
    db.add(row)
    if commit:
        db.commit()
    return row

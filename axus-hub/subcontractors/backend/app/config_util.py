"""Access to the single-row ComplianceConfig, creating it with spec defaults on
first use so business rules always have a home (never hard-coded)."""
from sqlalchemy.orm import Session

from app.models.config import ComplianceConfig


def get_config(db: Session) -> ComplianceConfig:
    cfg = db.query(ComplianceConfig).filter(ComplianceConfig.id == 1).first()
    if cfg is None:
        cfg = ComplianceConfig(
            id=1,
            coi_advance_notice_days=30,
            reminder_interval_days=7,
            agreement_renewal_months=24,
            agreement_advance_notice_days=30,
            notification_recipients="info@axustechnologies.com",
            additional_insured_name="Axus Technologies",
            additional_insured_address="13046 Racetrack Rd., Suite 255, Tampa, FL 33626",
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg

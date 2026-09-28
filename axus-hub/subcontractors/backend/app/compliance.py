"""Daily compliance engine (idempotent).

Run once per day (host cron -> `docker compose exec -T subcontractors python -m
app.compliance`). For every active subcontractor it recomputes compliance and,
where a reminder is due, sends it and advances the reminder cadence. Idempotency
comes from two guards: a request's `next_notification_at` gates when the next
reminder may go out, and `notify.already_sent_today()` prevents a second send of
the same type to the same recipient on the same day — so running the job multiple
times a day never duplicates email.
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app import notify, services
from app.activity import log_activity
from app.config_util import get_config
from app.tokens import issue_token
from app.models.subcontractor import Subcontractor
from app.models.document_request import DocumentRequest


def _open_request(db, sub_id, rtype):
    return db.query(DocumentRequest).filter(
        DocumentRequest.subcontractor_id == sub_id,
        DocumentRequest.request_type == rtype,
        DocumentRequest.status.in_(["open", "awaiting_review"]),
    ).first()


def _ensure_request(db, sub_id, rtype, due_date=None):
    req = _open_request(db, sub_id, rtype)
    created = False
    if req is None:
        req = DocumentRequest(subcontractor_id=sub_id, request_type=rtype,
                              status="open", due_date=due_date)
        db.add(req)
        db.flush()
        created = True
    return req, created


def _due(req, now) -> bool:
    return req.next_notification_at is None or _aware(req.next_notification_at) <= now


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _remind(db, sub, req, interval_days, email_type, subject, title, intro, lines=None, cta_url=None):
    """Send one reminder if not already sent today, and advance the cadence."""
    now = datetime.now(timezone.utc)
    if notify.already_sent_today(db, sub.id, email_type, sub.email):
        return
    notify.send(db, sub.id, sub.email, email_type, subject, title, intro,
                lines=lines, cta_text="Open onboarding" if cta_url else None,
                cta_url=cta_url, request_id=req.id)
    if req.first_notification_at is None:
        req.first_notification_at = now
    req.last_notification_at = now
    req.next_notification_at = now + timedelta(days=interval_days)
    req.reminder_count = (req.reminder_count or 0) + 1
    log_activity(db, sub.id, None, "reminder_sent", detail=f"{email_type} reminder sent")


def _check_onboarding(db, sub, cfg, now):
    if sub.vendor_status not in ("invited", "onboarding", "missing_documents"):
        return
    req = _open_request(db, sub.id, "onboarding")
    if req is None or req.status != "open" or not _due(req, now):
        return
    outstanding = services.outstanding_requirements(db, sub)
    if not outstanding:
        return
    raw = issue_token(db, sub.id)
    _remind(db, sub, req, cfg.reminder_interval_days, "onboarding_reminder",
            subject="Action Required — Axus Technologies Subcontractor Onboarding",
            title="Your Axus subcontractor onboarding is incomplete",
            intro="The following items are still outstanding:",
            lines=outstanding, cta_url=services.portal_link(raw))


def _check_coi(db, sub, cfg, now, today):
    exp = sub.coi_expiration_date
    if sub.coi_status in ("current", "expiring_soon") and exp:
        exp_d = exp if isinstance(exp, date) else exp.date()
        if exp_d <= today + timedelta(days=cfg.coi_advance_notice_days):
            req, created = _ensure_request(db, sub.id, "coi_renewal", due_date=exp_d)
            if created or _due(req, now):
                raw = issue_token(db, sub.id)
                _remind(db, sub, req, cfg.reminder_interval_days, "coi_renewal",
                        subject="Your Certificate of Insurance is expiring — Axus Technologies",
                        title="Please send an updated Certificate of Insurance",
                        intro=(f"Your COI on file expires {exp_d.isoformat()}. Please upload a "
                               "current COI naming Axus Technologies as additional insured "
                               f"({get_config(db).additional_insured_address})."),
                        cta_url=services.portal_link(raw))
    elif sub.coi_status == "expired":
        req, _ = _ensure_request(db, sub.id, "coi_renewal", due_date=exp)
        raw = issue_token(db, sub.id)
        _remind(db, sub, req, cfg.reminder_interval_days, "coi_overdue",
                subject="Your Certificate of Insurance has expired — Axus Technologies",
                title="Your COI has expired",
                intro="Our records show your Certificate of Insurance has expired. Please upload a current COI as soon as possible.",
                cta_url=services.portal_link(raw))
        if not notify.already_sent_today(db, sub.id, "internal_alert", "info@axustechnologies.com"):
            notify.send_internal_alert(
                db, subject=f"COI expired / non-compliant — {sub.legal_name}",
                title="A subcontractor's COI has expired",
                intro=f"{sub.legal_name} ({sub.public_id}) is non-compliant: COI expired.",
                subcontractor_id=sub.id)


def _check_agreement(db, sub, cfg, now, today):
    rd = sub.agreement_renewal_date
    if not rd:
        return
    rd_d = rd if isinstance(rd, date) else rd.date()
    if sub.agreement_status == "renewal_due" or (
        sub.agreement_status == "current" and rd_d <= today + timedelta(days=cfg.agreement_advance_notice_days)
    ):
        req, created = _ensure_request(db, sub.id, "agreement_renewal", due_date=rd_d)
        if created or _due(req, now):
            raw = issue_token(db, sub.id)
            _remind(db, sub, req, cfg.reminder_interval_days, "agreement_renewal",
                    subject="Time to renew your Axus Subcontractor Agreement",
                    title="Please re-sign your Axus Subcontractor Agreement",
                    intro=f"Your agreement is due for renewal by {rd_d.isoformat()}. Please review and sign.",
                    cta_url=services.portal_link(raw))
    elif sub.agreement_status == "expired":
        req, _ = _ensure_request(db, sub.id, "agreement_renewal", due_date=rd_d)
        raw = issue_token(db, sub.id)
        _remind(db, sub, req, cfg.reminder_interval_days, "agreement_overdue",
                subject="Your Axus Subcontractor Agreement is overdue",
                title="Your Subcontractor Agreement renewal is overdue",
                intro="Your agreement renewal is past due. Please re-sign to remain an active Axus subcontractor.",
                cta_url=services.portal_link(raw))


def run(db: Session) -> dict:
    cfg = get_config(db)
    now = datetime.now(timezone.utc)
    today = date.today()
    subs = db.query(Subcontractor).filter(
        Subcontractor.deleted_at.is_(None),
        Subcontractor.vendor_status != "inactive",
    ).all()
    for sub in subs:
        services.recompute_compliance(db, sub)
        _check_onboarding(db, sub, cfg, now)
        _check_coi(db, sub, cfg, now, today)
        _check_agreement(db, sub, cfg, now, today)
    db.commit()
    return {"checked": len(subs), "at": now.isoformat()}


if __name__ == "__main__":
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        print("[compliance]", run(db))
    finally:
        db.close()

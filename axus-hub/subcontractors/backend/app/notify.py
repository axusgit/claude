"""Email automation for subcontractor compliance.

Wraps the shared SMTP mailer and logs every attempt to `email_log` (per-recipient
delivery status). Guardrails mirror Support's soft-launch pattern so test runs
never reach real vendors:

  NOTIFY_ENABLED=0   -> vendor-facing emails are skipped (logged as "skipped")
  NOTIFY_ALLOW=a@x,… -> when set, only these recipients receive mail

Never carries document contents (no W-9/COI attachments) — links only. To avoid
sending multiple reminders to the same vendor on the same day, callers use
`already_sent_today()` / the daily engine consolidates outstanding items into one
email where possible.
"""
import os
from datetime import date, datetime

from sqlalchemy.orm import Session

from app import mailer
from app.models.email_log import EmailLog

NOTIFY_ENABLED = os.getenv("NOTIFY_ENABLED", "0") == "1"
_ALLOW = {a.strip().lower() for a in os.getenv("NOTIFY_ALLOW", "").split(",") if a.strip()}

LOGO = "https://axustechnologies.com/wp-content/uploads/2023/03/axus-technologies-logo.png"


def _allowed(recipient: str) -> bool:
    if not NOTIFY_ENABLED:
        return False
    if _ALLOW and recipient.lower() not in _ALLOW:
        return False
    return True


def _html(title: str, intro: str, lines: list[str] = None, cta_text: str = None, cta_url: str = None) -> str:
    items = ""
    if lines:
        items = "<ul style='margin:12px 0;padding-left:20px'>" + "".join(
            f"<li style='margin:4px 0'>{l}</li>" for l in lines
        ) + "</ul>"
    button = ""
    if cta_text and cta_url:
        button = (
            f"<p style='margin:20px 0'><a href='{cta_url}' "
            "style='background:#f26522;color:#fff;text-decoration:none;padding:10px 18px;"
            "border-radius:8px;font-weight:600;display:inline-block'>" + cta_text + "</a></p>"
        )
    return (
        "<div style='font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:560px'>"
        f"<img src='{LOGO}' alt='Axus Technologies' style='height:34px;margin-bottom:16px'>"
        f"<h2 style='font-size:18px;margin:0 0 8px'>{title}</h2>"
        f"<p style='margin:8px 0;line-height:1.5'>{intro}</p>"
        f"{items}{button}"
        "<p style='margin:20px 0 0;color:#666;font-size:12px'>Axus Technologies · "
        "13046 Racetrack Rd., Suite 255, Tampa, FL 33626</p>"
        "</div>"
    )


def log_email(db, subcontractor_id, recipient, email_type, subject, status, error=None, request_id=None):
    db.add(EmailLog(
        subcontractor_id=subcontractor_id, request_id=request_id, recipient=recipient,
        email_type=email_type, subject=subject, status=status, error=error,
    ))


def already_sent_today(db: Session, subcontractor_id: int, email_type: str, recipient: str) -> bool:
    """True if we already logged a successful send of this type to this recipient
    today — the daily engine uses this to stay idempotent across multiple runs."""
    today = date.today()
    q = db.query(EmailLog).filter(
        EmailLog.subcontractor_id == subcontractor_id,
        EmailLog.email_type == email_type,
        EmailLog.recipient == recipient,
        EmailLog.status == "sent",
    )
    for row in q.all():
        created = row.created_at
        if created and created.date() == today:
            return True
    return False


def send(db, subcontractor_id, recipient, email_type, subject, title, intro,
         lines=None, cta_text=None, cta_url=None, request_id=None) -> bool:
    """Send one vendor email and log the outcome. Returns True if actually sent."""
    if not recipient:
        return False
    if not _allowed(recipient):
        log_email(db, subcontractor_id, recipient, email_type, subject, "skipped",
                  error="notify disabled or recipient not allowlisted", request_id=request_id)
        return False
    html = _html(title, intro, lines, cta_text, cta_url)
    text = title + "\n\n" + intro + ("\n- " + "\n- ".join(lines) if lines else "") + \
        (f"\n\n{cta_text}: {cta_url}" if cta_url else "")
    ok = mailer.send_email(recipient, subject, text, html=html)
    log_email(db, subcontractor_id, recipient, email_type, subject,
              "sent" if ok else "failed",
              error=None if ok else "smtp send failed/not configured", request_id=request_id)
    return ok


def send_internal_alert(db, subject, title, intro, lines=None, subcontractor_id=None) -> None:
    """Compliance alert to the internal recipient(s) from config. Internal alerts
    are not subject to the vendor allowlist, but still respect NOTIFY_ENABLED."""
    from app.config_util import get_config
    cfg = get_config(db)
    recipients = [r.strip() for r in (cfg.notification_recipients or "").split(",") if r.strip()]
    html = _html(title, intro, lines)
    text = title + "\n\n" + intro + ("\n- " + "\n- ".join(lines) if lines else "")
    for r in recipients:
        ok = mailer.send_email(r, subject, text, html=html) if NOTIFY_ENABLED else False
        log_email(db, subcontractor_id, r, "internal_alert", subject,
                  "sent" if ok else "skipped")

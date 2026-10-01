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

LOGO = "https://subcontractors.hub.axustechnologies.com/static/axus-logo.png"


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
        "<div style='background:#f4f5f7;padding:24px 12px;font-family:Inter,Arial,sans-serif'>"
        "<div style='max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;"
        "border-top:3px solid #f26522;border-radius:12px;overflow:hidden'>"
        # Header — small logo
        "<div style='padding:16px 24px 12px;border-bottom:1px solid #eef0f2'>"
        f"<img src='{LOGO}' alt='Axus Technologies' height='22' "
        "style='height:22px;width:auto;display:block;border:0'></div>"
        # Body
        "<div style='padding:20px 24px;color:#1a1a1a'>"
        f"<h2 style='font-size:17px;margin:0 0 10px;font-weight:600'>{title}</h2>"
        f"<p style='margin:8px 0;line-height:1.55;font-size:14px'>{intro}</p>"
        f"{items}{button}"
        "</div>"
        # Footer
        "<div style='padding:14px 24px;border-top:1px solid #eef0f2;color:#8a94a3;"
        "font-size:12px;line-height:1.5'>"
        "This mailbox is not monitored — please do not reply to this email. "
        "If you have questions or need help, contact your Axus Technologies representative.<br>"
        "<span style='color:#6b7280'>Axus Technologies &middot; 13046 Racetrack Rd., Suite 255, Tampa, FL 33626</span>"
        "</div>"
        "</div></div>"
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
        (f"\n\n{cta_text}: {cta_url}" if cta_url else "") + \
        ("\n\nThis mailbox is not monitored — please do not reply to this email. "
         "If you have questions or need help, contact your Axus Technologies representative."
         "\n\nAxus Technologies · 13046 Racetrack Rd., Suite 255, Tampa, FL 33626")
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

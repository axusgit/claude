"""Minimal SMTP mailer for outbound app email (staff notifications).

Uses the platform's O365 relay, wired from the AUTHENTIK_EMAIL__* creds into
SMTP_* env on the support container (see infra/docker-compose.yml). Degrades to a
no-op log when SMTP isn't configured, so callers never need to guard.
"""
import os
import smtplib
import ssl
from email.message import EmailMessage

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USER
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() in ("1", "true", "yes")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def send_email(to, subject: str, body: str, html: str = None) -> bool:
    """Send an email. `to` is a string or a list of addresses. When `html` is
    given, the message is multipart/alternative (plain `body` + HTML) so clients
    that block or can't render HTML still show the text. Best-effort: returns
    False (and logs) instead of raising."""
    if not is_configured():
        print(f"[mailer] (no SMTP configured) would send: {subject}", flush=True)
        return False
    recipients = [to] if isinstance(to, str) else list(to)
    recipients = [r for r in recipients if r]
    if not recipients:
        return False
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=30) as s:
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
                s.ehlo()
                if SMTP_USE_TLS:
                    s.starttls(context=ctx)
                    s.ehlo()
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
        print(f"[mailer] sent to {len(recipients)} recipient(s): {subject}", flush=True)
        return True
    except Exception as e:
        print(f"[mailer] send failed: {e}", flush=True)
        return False

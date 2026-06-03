"""Microsoft Graph client (app-only / client credentials) for a shared mailbox.

Used by email-to-ticket: read unread mail, mark it read, and send notifications.
All calls are synchronous (the poller runs in a background thread and the SQLAlchemy
session is sync). Disabled gracefully when the GRAPH_* env vars are absent.
"""
import os
import time
import threading
import httpx

TENANT = os.getenv("GRAPH_TENANT_ID")
CLIENT_ID = os.getenv("GRAPH_CLIENT_ID")
CLIENT_SECRET = os.getenv("GRAPH_CLIENT_SECRET")
MAILBOX = os.getenv("SUPPORT_MAILBOX")

GRAPH = "https://graph.microsoft.com/v1.0"
_tok = {"value": None, "exp": 0}
_lock = threading.Lock()


def is_configured() -> bool:
    return all([TENANT, CLIENT_ID, CLIENT_SECRET, MAILBOX])


def _token() -> str:
    with _lock:
        if _tok["value"] and _tok["exp"] > time.time() + 60:
            return _tok["value"]
        r = httpx.post(
            f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token",
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=20,
        )
        r.raise_for_status()
        j = r.json()
        _tok["value"] = j["access_token"]
        _tok["exp"] = time.time() + int(j.get("expires_in", 3600))
        return _tok["value"]


def _headers(extra=None):
    h = {"Authorization": f"Bearer {_token()}"}
    if extra:
        h.update(extra)
    return h


def fetch_unread(top: int = 25):
    """Unread inbox messages, body as plain text."""
    url = (
        f"{GRAPH}/users/{MAILBOX}/mailFolders/inbox/messages"
        f"?$filter=isRead eq false&$top={top}"
        f"&$select=id,subject,from,body,bodyPreview,conversationId,receivedDateTime"
    )
    r = httpx.get(url, headers=_headers({"Prefer": 'outlook.body-content-type="text"'}), timeout=30)
    r.raise_for_status()
    return r.json().get("value", [])


def mark_read(message_id: str):
    r = httpx.patch(f"{GRAPH}/users/{MAILBOX}/messages/{message_id}",
                    headers=_headers(), json={"isRead": True}, timeout=20)
    r.raise_for_status()


def _parse_data_url(data_url: str):
    """('data:image/png;base64,AAAA') -> (content_type, base64_str) or None."""
    try:
        head, b64 = data_url.split(",", 1)
        ctype = head[len("data:"):].split(";", 1)[0] or "image/png"
        return ctype, b64
    except Exception:
        return None


def send_mail(to_email: str, subject: str, body_text: str, logo_data_url: str | None = None):
    msg = {
        "subject": subject,
        "toRecipients": [{"emailAddress": {"address": to_email}}],
    }
    parsed = _parse_data_url(logo_data_url) if logo_data_url else None
    if parsed:
        # HTML body so the signature logo renders; the image is sent inline (CID),
        # which is far more reliable across mail clients than a data: URI.
        ctype, b64 = parsed
        import html as _html
        cid = "axus-sig-logo"
        body_html = _html.escape(body_text).replace("\n", "<br>")
        msg["body"] = {
            "contentType": "HTML",
            "content": f'<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">{body_html}'
                       f'<br><img src="cid:{cid}" alt="logo" style="max-height:64px"></div>',
        }
        msg["attachments"] = [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": "logo.png", "contentType": ctype,
            "isInline": True, "contentId": cid, "contentBytes": b64,
        }]
    else:
        msg["body"] = {"contentType": "Text", "content": body_text}
    r = httpx.post(f"{GRAPH}/users/{MAILBOX}/sendMail",
                   headers=_headers(), json={"message": msg, "saveToSentItems": True}, timeout=30)
    r.raise_for_status()

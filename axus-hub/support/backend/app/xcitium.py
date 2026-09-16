"""Read-only client for the legacy Xcitium (Comodo) Service Desk `clientapi`.

Auth: the RAW API key (hex, NOT base64) in the `Authorization` header. The key is
generated in Service Desk -> Admin Panel -> Manage -> API Keys and must have the
caller's egress IP allowlisted. Disabled gracefully when XCITIUM_API_KEY is absent.

Only read services are used here; nothing writes back to Xcitium. The public API of
this instance is narrow -- `viewticket` (admin-scoped, keyed by ticket id) is the
workhorse; there is no user/customer list endpoint, so tickets are enumerated by
sweeping ids. See app/xcitium_sync.py.
"""
import os
import time
import httpx

HOST = os.getenv("XCITIUM_HOST", "axustechnologies.servicedesk.comodo.com")
API_KEY = os.getenv("XCITIUM_API_KEY")
BASE = os.getenv("XCITIUM_BASE_URL", f"https://{HOST}/clientapi/index.php")

TIMEOUT = float(os.getenv("XCITIUM_TIMEOUT", "30"))
MAX_RETRIES = int(os.getenv("XCITIUM_MAX_RETRIES", "4"))


class XcitiumError(Exception):
    pass


class XcitiumAuthError(XcitiumError):
    pass


def is_configured() -> bool:
    return bool(API_KEY)


def _call(service: str, payload: dict | None = None) -> dict:
    """POST one service call. Retries transient failures (timeouts / 5xx) with
    exponential backoff -- the Xcitium backend is known to hang or 502 under load.
    Returns the parsed JSON envelope: {code, status, message, data?}."""
    if not is_configured():
        raise XcitiumError("XCITIUM_API_KEY not configured")
    headers = {"Content-Type": "application/json", "Authorization": API_KEY}
    params = {"serviceName": service}
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            r = httpx.post(BASE, params=params, headers=headers,
                           json=(payload or {}), timeout=TIMEOUT)
            if r.status_code >= 500:
                raise XcitiumError(f"HTTP {r.status_code} from {service}")
            body = r.json()
        except (httpx.TimeoutException, httpx.TransportError, XcitiumError, ValueError) as e:
            last_exc = e
            time.sleep(min(2 ** attempt, 15))
            continue
        code = body.get("code")
        if code == 401:
            raise XcitiumAuthError(body.get("message") or "Authorization Failed")
        return body
    raise XcitiumError(f"{service} failed after {MAX_RETRIES} attempts: {last_exc}")


def viewticket(ticket_id: int) -> dict | None:
    """Full ticket detail, or None if the id doesn't exist / was deleted (404)."""
    body = _call("viewticket", {"ticketId": str(ticket_id)})
    if body.get("code") == 200:
        return body.get("data")
    if body.get("code") == 404:
        return None
    raise XcitiumError(f"viewticket {ticket_id}: {body.get('code')} {body.get('message')}")


def ticket_exists(ticket_id: int) -> bool:
    return viewticket(ticket_id) is not None


def get_users(page_size: int = 100) -> list:
    """Every user in the Xcitium User Directory (customer end users), paginated.
    Each record: {id, name, created, address(email)}. Note: no organization link
    is returned here -- that comes from the tickets (viewticket user object)."""
    out = []
    page = 1
    while page <= 200:  # safety cap
        body = _call("getUsers", {"keyword": "", "pageNo": page, "pageSize": page_size})
        data = body.get("data", []) if body.get("code") == 200 else []
        out.extend(data)
        if len(data) < page_size:
            break
        page += 1
    return out


def get_categories() -> list:
    body = _call("getcategories", {})
    return body.get("data", []) if body.get("code") == 200 else []


def get_asset_types() -> list:
    body = _call("getassets", {})
    return body.get("data", []) if body.get("code") == 200 else []

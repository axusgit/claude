"""Auto-responder for the service@ mailbox.

There is no email-to-ticket (portal-only), so anyone who replies to a notification
or emails service@ gets ONE friendly redirect to the portal. Reads unread inbox mail
via Microsoft Graph, sends a branded reply from service@, and marks the message read.

Safeguards:
  * ONCE per sender  — persistent seen-list at SEEN_FILE (survives restarts).
  * No mail loops     — skips bounces / other auto-replies / no-reply & system senders.
  * Never creates tickets (this is separate from the disabled email-intake poller).

Gated by AUTOREPLY_ENABLED=1; needs the same GRAPH_* + SUPPORT_MAILBOX env as intake.
"""
import os
import re
import time
import threading

from app import graph, mailer

SEEN_FILE = os.getenv("AUTOREPLY_SEEN_FILE", "/data/uploads/autoreply_seen.txt")
PORTAL = os.getenv("PORTAL_URL", "https://service.axustechnologies.com").rstrip("/")

REPLY_SUBJECT = "Axus Service Desk — please use our portal"
REPLY_BODY = (
    "Thanks for contacting Axus Technologies.\n\n"
    "This mailbox (service@axustechnologies.com) sends Service Desk notifications and "
    "isn't monitored, so replies sent here aren't seen by our team.\n\n"
    "To reach us or manage your support tickets, please use our Service Desk portal:\n"
    f"  {PORTAL}\n\n"
    "Just enter your email for a secure, passwordless sign-in link — your existing "
    "tickets are already there, and you can open a new request anytime. You can also "
    "reach it from axustechnologies.com by clicking Service Login.\n\n"
    "Thank you,\n"
    "Axus Service Team"
)

# Senders we must NEVER auto-reply to (loop / noise protection).
_SKIP_SENDER = re.compile(
    r"(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|microsoftexchange|abuse@)", re.I)
# Subjects that indicate auto-generated mail (bounces, other OOF, etc.).
_SKIP_SUBJECT = re.compile(
    r"^\s*(re:\s*)?(automatic reply|undeliverable|auto:|out of office|delivery (status|has failed)|mail delivery)", re.I)


def _load_seen():
    try:
        with open(SEEN_FILE) as f:
            return {ln.strip().lower() for ln in f if ln.strip()}
    except FileNotFoundError:
        return set()


def _mark_seen(email):
    try:
        os.makedirs(os.path.dirname(SEEN_FILE), exist_ok=True)
        with open(SEEN_FILE, "a") as f:
            f.write(email.lower() + "\n")
    except Exception:
        pass


def process_once() -> dict:
    """One pass over the unread inbox. Returns a small summary."""
    if not graph.is_configured():
        return {"configured": False}
    seen = _load_seen()
    replied = skipped = 0
    for m in graph.fetch_unread():
        try:
            addr = (((m.get("from") or {}).get("emailAddress") or {}).get("address") or "").strip().lower()
            subj = m.get("subject") or ""
            mid = m.get("id")
            own_domain = "@" + (graph.MAILBOX or "").split("@")[-1].lower()
            if (not addr or _SKIP_SENDER.search(addr) or _SKIP_SUBJECT.search(subj)
                    or addr.endswith(own_domain)):   # skip our own staff/system senders
                graph.mark_read(mid)
                skipped += 1
                continue
            if addr not in seen:
                # Send via our existing SMTP relay (service@), NOT Graph — so the
                # Graph app never needs the Mail.Send permission (smaller blast radius).
                mailer.send_email([addr], REPLY_SUBJECT, REPLY_BODY)
                _mark_seen(addr)
                seen.add(addr)
                replied += 1
                print(f"[auto-reply] replied -> {addr}", flush=True)
            graph.mark_read(mid)
        except Exception as e:
            print("[auto-reply] error on a message:", e, flush=True)
    return {"configured": True, "replied": replied, "skipped": skipped}


def start_scheduler_thread():
    interval = max(30, int(os.getenv("AUTOREPLY_POLL_SECONDS", "60")))

    def loop():
        while True:
            try:
                process_once()
            except Exception:
                pass
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="auto-reply").start()
    print(f"[auto-reply] poller started (every {interval}s, mailbox {graph.MAILBOX})", flush=True)

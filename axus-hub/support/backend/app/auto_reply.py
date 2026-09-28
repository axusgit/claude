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
import json
import time
import threading

from app import graph, mailer

PORTAL = os.getenv("PORTAL_URL", "https://service.axustechnologies.com").rstrip("/")

# Abuse / loop throttle: > RATE_LIMIT replies from one address within RATE_WINDOW
# seconds locks that address (no replies, mail still marked read) for LOCK_SECONDS.
RATE_FILE = os.getenv("AUTOREPLY_RATE_FILE", "/data/uploads/autoreply_rate.json")
RATE_LIMIT = int(os.getenv("AUTOREPLY_RATE_LIMIT", "5"))          # replies allowed per window
RATE_WINDOW = int(os.getenv("AUTOREPLY_RATE_WINDOW_SEC", "600"))  # 10 minutes
LOCK_SECONDS = int(os.getenv("AUTOREPLY_LOCK_SEC", "3600"))       # 60 minutes
ALERT_TO = os.getenv("XCITIUM_ALERT_EMAIL", "acarr@axustechnologies.com")

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
# Subjects that indicate auto-generated mail (bounces, other OOF) OR a reply to our
# own auto-reply — skipping the latter stops two auto-responders volleying forever.
_SKIP_SUBJECT = re.compile(
    r"^\s*(re:\s*)?(automatic reply|undeliverable|auto:|out of office|delivery (status|has failed)|mail delivery)", re.I)
_OUR_SUBJECT_SIG = "please use our portal"   # our own reply subject — never reply to a reply of it


def _load_rate():
    try:
        with open(RATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_rate(state):
    try:
        os.makedirs(os.path.dirname(RATE_FILE), exist_ok=True)
        tmp = RATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, RATE_FILE)
    except Exception:
        pass


def _throttle_check(state, addr, now):
    """Return (allowed, newly_locked). Prunes old hits; locks a sender that exceeds the
    rate. A locked sender stays locked (no reply) until LOCK_SECONDS passes."""
    rec = state.get(addr) or {"hits": [], "locked_until": 0}
    if rec.get("locked_until", 0) > now:
        return False, False                      # still in a lock window
    rec["hits"] = [t for t in rec.get("hits", []) if now - t < RATE_WINDOW]
    if len(rec["hits"]) >= RATE_LIMIT:           # already at the limit within the window
        rec["locked_until"] = now + LOCK_SECONDS
        rec["hits"] = []
        state[addr] = rec
        return False, True                       # just tripped the lock
    rec["hits"].append(now)
    state[addr] = rec
    return True, False


def process_once() -> dict:
    """One pass over the unread inbox. Replies to EVERY genuine inbound message (so a
    client who emails again always gets the reminder), skipping auto-generated mail /
    our own domain / replies to our own auto-reply, and throttling abusive senders."""
    if not graph.is_configured():
        return {"configured": False}
    state = _load_rate()
    now = time.time()
    replied = skipped = locked = 0
    for m in graph.fetch_unread():
        try:
            addr = (((m.get("from") or {}).get("emailAddress") or {}).get("address") or "").strip().lower()
            subj = m.get("subject") or ""
            mid = m.get("id")
            own_domain = "@" + (graph.MAILBOX or "").split("@")[-1].lower()
            if (not addr or _SKIP_SENDER.search(addr) or _SKIP_SUBJECT.search(subj)
                    or _OUR_SUBJECT_SIG in subj.lower()      # a reply to our own auto-reply
                    or addr.endswith(own_domain)):           # our own staff/system senders
                graph.mark_read(mid)
                skipped += 1
                continue
            allowed, newly_locked = _throttle_check(state, addr, now)
            if not allowed:
                graph.mark_read(mid)
                skipped += 1
                if newly_locked:
                    locked += 1
                    print(f"[auto-reply] LOCKED {addr} for {LOCK_SECONDS//60} min "
                          f"(> {RATE_LIMIT} in {RATE_WINDOW//60} min)", flush=True)
                    try:
                        mailer.send_email([ALERT_TO],
                            f"[Axus Service Desk] auto-reply throttle tripped: {addr}",
                            f"{addr} emailed service@ more than {RATE_LIMIT} times in "
                            f"{RATE_WINDOW//60} minutes and is now locked (no auto-replies) "
                            f"for {LOCK_SECONDS//60} minutes. Their mail still arrives in "
                            f"service@ — this only pauses the auto-reply. -- auto-reply throttle")
                    except Exception:
                        pass
                continue
            # Reply EVERY time — sent via our existing SMTP relay (service@), not Graph.
            mailer.send_email([addr], REPLY_SUBJECT, REPLY_BODY)
            replied += 1
            print(f"[auto-reply] replied -> {addr}", flush=True)
            graph.mark_read(mid)
        except Exception as e:
            print("[auto-reply] error on a message:", e, flush=True)
    # drop senders with no recent activity and no active lock, then persist
    state = {a: r for a, r in state.items()
             if r.get("locked_until", 0) > now or r.get("hits")}
    _save_rate(state)
    return {"configured": True, "replied": replied, "skipped": skipped, "locked": locked}


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

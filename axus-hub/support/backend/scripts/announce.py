"""One-off client announcement blast for the Axus Service Desk cutover.

Sends a personalized message to every active client user (role=client) from
service@ (SUPPORT_SMTP_FROM), one recipient per message, throttled, with a
persistent sent-log so nobody is emailed twice and a run can resume.

Controls (env):
  CAMP=headsup|golive   which message
  DRY=1|0               1 = list only, send nothing (default 1)
  TEST_TO=<email>       send ONLY to this address (preview), ignores the sent-log
  THROTTLE=<seconds>    delay between sends (default 1.5 -> ~40/min)
"""
import os, sys, time, html as _h
sys.path.insert(0, os.getcwd())
from app.database import SessionLocal
from app.models.user import User, UserRole
from app import mailer

CAMP = os.getenv("CAMP", "headsup")
DRY = os.getenv("DRY", "1") == "1"
TEST_TO = (os.getenv("TEST_TO") or "").strip()
THROTTLE = float(os.getenv("THROTTLE", "1.5"))
SENTLOG = f"/data/uploads/announce_sent_{CAMP}.txt"
PORTAL = "https://service.axustechnologies.com"
LOGO = "https://axustechnologies.com/wp-content/themes/awi/img/axus-technologies-logo.png"


def _shell(inner_html: str) -> str:
    return f"""\
<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2430;">
    <tr><td style="padding:26px 32px 6px;"><img src="{LOGO}" alt="Axus Technologies" height="32" style="height:32px;display:block;border:0;" /></td></tr>
    <tr><td style="padding:6px 32px 26px;">{inner_html}</td></tr>
    <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0f3;"><p style="margin:14px 0 0;font-size:12px;color:#9aa1ac;">Axus Technologies &middot; Simplifying IT<br/>You're receiving this because Axus provides IT support for your organization.</p></td></tr>
  </table>
</td></tr></table>
</body></html>"""


def _btn(label):
    return (f'<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#f26722;">'
            f'<a href="{PORTAL}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">{label}</a>'
            f'</td></tr></table>')


def headsup(fn):
    n = _h.escape(fn)
    subject = "We're upgrading your Axus support portal — live Monday, Sept 28"
    html = _shell(f"""
      <h1 style="margin:12px 0 6px;font-size:20px;">A better support experience — live Monday, Sept 28</h1>
      <p style="margin:10px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Hi {n},</p>
      <p style="margin:10px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">As part of our commitment to faster, more reliable service, Axus Technologies is launching a new support portal. It goes <strong>live on Monday, September 28, 2026</strong>. Until then, please continue to reach us as you do today — <strong>the new portal isn't available yet, so there's no need to do anything before Monday.</strong></p>
      <p style="margin:16px 0 4px;font-size:14.5px;line-height:1.6;color:#3a4150;"><strong>What's changing on Monday</strong></p>
      <ul style="margin:4px 0 0;padding-left:20px;font-size:14.5px;line-height:1.7;color:#3a4150;">
        <li>A modern, faster support portal at <a href="{PORTAL}" style="color:#f26722;">service.axustechnologies.com</a>.</li>
        <li>Passwordless sign-in — no password to remember; we email you a secure one-time link.</li>
        <li>Your open tickets come with you — nothing is lost.</li>
      </ul>
      <p style="margin:16px 0 4px;font-size:14.5px;line-height:1.6;color:#3a4150;"><strong>How you'll get there</strong></p>
      <p style="margin:4px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">From Monday, just visit our website at <a href="https://axustechnologies.com/" style="color:#f26722;">axustechnologies.com</a> and click the <strong>Service Login</strong> button (top right) — or go straight to <a href="{PORTAL}" style="color:#f26722;">service.axustechnologies.com</a>. (You may know this button as "Support Login" — we've renamed it "Service Login.")</p>
      <p style="margin:16px 0 4px;font-size:14.5px;line-height:1.6;color:#3a4150;"><strong>What you need to do</strong></p>
      <p style="margin:4px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Nothing before Monday — the portal won't be live until then, so please wait until Monday to sign in. We'll email you again on launch day with everything you need to get started, and our previous system will be retired.</p>
      <p style="margin:18px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">If you have any questions, just reply to this email.</p>
      <p style="margin:18px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Thank you for choosing our services.<br/>Axus Service Team</p>
    """)
    text = (f"Hi {fn},\n\n"
            "As part of our commitment to faster, more reliable service, Axus Technologies is launching a new "
            "support portal. It goes LIVE on Monday, September 28, 2026. Until then, please continue to reach us "
            "as you do today - the new portal isn't available yet, so there's no need to do anything before Monday.\n\n"
            "What's changing on Monday\n"
            f"- A modern, faster support portal at {PORTAL}\n"
            "- Passwordless sign-in - no password to remember; we email you a secure one-time link.\n"
            "- Your open tickets come with you - nothing is lost.\n\n"
            "How you'll get there\n"
            "From Monday, just visit our website at https://axustechnologies.com/ and click the Service Login "
            f"button (top right) - or go straight to {PORTAL}. (You may know this button as \"Support Login\" - "
            "we've renamed it \"Service Login.\")\n\n"
            "What you need to do\n"
            "Nothing before Monday - the portal won't be live until then, so please wait until Monday to sign in. "
            "We'll email you again on launch day with everything you need to get started, and our previous system "
            "will be retired.\n\n"
            "If you have any questions, just reply to this email.\n\n"
            "Thank you for choosing our services.\nAxus Service Team")
    return subject, text, html


def golive(fn):
    n = _h.escape(fn)
    subject = "Your new Axus support portal is now live"
    html = _shell(f"""
      <h1 style="margin:12px 0 6px;font-size:20px;">Your new support portal is live</h1>
      <p style="margin:10px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Hi {n}, welcome!</p>
      <p style="margin:12px 0 16px;font-size:14.5px;line-height:1.6;color:#3a4150;">Our new support portal is live now. Sign in below to see your tickets and open new requests.</p>
      {_btn("Sign in to the portal")}
      <p style="margin:18px 0 4px;font-size:14.5px;line-height:1.6;color:#3a4150;"><strong>How to sign in (no password needed)</strong></p>
      <ol style="margin:4px 0 0;padding-left:20px;font-size:14.5px;line-height:1.7;color:#3a4150;">
        <li>Go to <a href="{PORTAL}" style="color:#f26722;">service.axustechnologies.com</a> and enter your work email.</li>
        <li>We'll email you a secure sign-in link — click it and you're in.</li>
        <li>The link works once and expires in 15 minutes; your session then stays active for 30 days.</li>
      </ol>
      <p style="margin:16px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">You can also reach the portal anytime from our website — go to <a href="https://axustechnologies.com/" style="color:#f26722;">axustechnologies.com</a> and click the <strong>Service Login</strong> button (top right).</p>
      <p style="margin:16px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Your existing open tickets are already there. To open a new request, sign in and click <strong>New Ticket</strong>. You'll get email updates whenever we reply, with a link back to the conversation.</p>
      <p style="margin:16px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Questions or trouble signing in? Just reply to this email.</p>
      <p style="margin:18px 0 0;font-size:14.5px;line-height:1.6;color:#3a4150;">Thank you for choosing our services.<br/>Axus Service Team</p>
    """)
    text = (f"Hi {fn}, welcome!\n\n"
            f"Our new support portal is live now: {PORTAL}\n\n"
            "How to sign in (no password needed):\n"
            "1. Go to the link above and enter your work email.\n"
            "2. We'll email you a secure sign-in link - click it and you're in.\n"
            "3. The link works once and expires in 15 minutes; your session then stays active for 30 days.\n\n"
            "You can also reach the portal anytime from our website - go to https://axustechnologies.com/ and "
            "click the Service Login button (top right).\n\n"
            "Your existing open tickets are already there. To open a new request, sign in and click New Ticket. "
            "You'll get email updates whenever we reply, with a link back to the conversation.\n\n"
            "Questions or trouble signing in? Just reply to this email.\n\n"
            "Thank you for choosing our services.\nAxus Service Team")
    return subject, text, html


BUILDERS = {"headsup": headsup, "golive": golive}


def first_name(full):
    parts = (full or "").strip().split()
    return parts[0] if parts else "there"


def main():
    if CAMP not in BUILDERS:
        print("unknown CAMP:", CAMP); return
    sent = set()
    if os.path.exists(SENTLOG):
        sent = {l.strip().lower() for l in open(SENTLOG) if l.strip()}

    db = SessionLocal()
    seen, recips = set(), []
    for u in db.query(User).filter(User.role == UserRole.client, User.is_active == True).all():  # noqa: E712
        em = (u.email or "").strip().lower()
        if not em or "@" not in em or "." not in em.rsplit("@", 1)[-1] or em in seen:
            continue
        seen.add(em)
        recips.append((u.full_name, em))
    db.close()

    if TEST_TO:
        recips = [("Andy Carrazana", TEST_TO)]

    print(f"campaign={CAMP} eligible={len(recips)} already_sent={len(sent)} DRY={DRY} TEST={TEST_TO or '-'} throttle={THROTTLE}s")
    processed = ok_n = 0
    for name, em in recips:
        if not TEST_TO and em in sent:
            continue
        fn = first_name(name)
        subject, text, html = BUILDERS[CAMP](fn)
        if DRY:
            print("  would send ->", em, "|", fn)
            continue
        ok = False
        try:
            ok = mailer.send_email([em], subject, text, html)
        except Exception as e:
            print("  ERROR ->", em, e)
        if ok and not TEST_TO:
            with open(SENTLOG, "a") as f:
                f.write(em + "\n")
        ok_n += 1 if ok else 0
        processed += 1
        print(("  sent" if ok else "  FAIL"), "->", em)
        time.sleep(THROTTLE)
    print(f"done. processed={processed} ok={ok_n}")


if __name__ == "__main__":
    main()

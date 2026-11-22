#!/usr/bin/env bash
# Give a person access to ONE client business in ACAS (Communications Analytics).
# Groups: app-acas (ACAS access + Hub tile) and acas:tenant:<slug> (which business).
#  - New person   -> Authentik invitation + branded set-up email (groups attach on
#                    enrollment via reconcile-invite-groups.sh).
#  - Existing one -> groups added directly + a short "you now have access" email.
# Refuses to put a person in a SECOND client group (ACAS fails closed on that anyway).
#
# Usage: invite-acas.sh <email> "<Full Name>" <tenant-slug>
set -euo pipefail

EMAIL="${1:?usage: invite-acas.sh <email> \"<Full Name>\" <tenant-slug>}"
NAME="${2:?name required (quote it)}"
SLUG="${3:?tenant-slug required}"

cd /home/ubuntu/axus-platform/infra

PYCODE=$(cat <<'PY'
import os, datetime
from django.utils import timezone
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from authentik.flows.models import Flow
from authentik.core.models import User, Group
from authentik.stages.invitation.models import Invitation

email = os.environ["I_EMAIL"].strip()
name  = os.environ["I_NAME"].strip()
slug  = os.environ["I_SLUG"].strip()
tgroup = "acas:tenant:" + slug
groups = ["app-acas", tgroup]

missing = [g for g in groups if not Group.objects.filter(name=g).exists()]
if missing:
    print("ERROR: unknown group(s): " + ", ".join(missing))
    print("Run acas-link-tenant.sh " + slug + " first (and create the client on the ACAS Clients page).")
    raise SystemExit(1)

ACAS = "https://acas.axustechnologies.com"
first = (name.split(" ")[0] if name else "there")

def send(subject, text, html):
    msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [email])
    msg.attach_alternative(html, "text/html")
    try:
        print("SENT" if msg.send() else "NOT SENT", "->", email)
    except Exception as exc:
        print("EMAIL NOT SENT (" + str(exc) + ")")

def html_card(title, body, url, button):
    return (
'<div style="margin:0;padding:0;background:#f5f6f8;">'
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 12px;"><tr><td align="center">'
'<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;overflow:hidden;">'
'<tr><td style="height:4px;background:#ea580c;"></td></tr>'
'<tr><td style="padding:32px 36px 8px;">'
'<img src="https://axustechnologies.com/wp-content/themes/awi/img/axus-technologies-logo.png" alt="Axus" height="30" style="display:block;border:0;margin-bottom:24px;">'
'<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827;">' + title + '</h1>'
'<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' + first + ',</p>'
'<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#374151;">' + body + '</p></td></tr>'
'<tr><td style="padding:0 36px 32px;"><a href="' + url + '" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">' + button + '</a></td></tr>'
'<tr><td style="padding:16px 36px;background:#fafafa;border-top:1px solid #f0f0f0;"><p style="margin:0;font-size:12px;color:#9ca3af;">Axus Technologies &middot; axustechnologies.com</p></td></tr>'
'</table></td></tr></table></div>')

user = User.objects.filter(email__iexact=email).first()
if user is not None:
    other = [g.name for g in user.groups.all() if g.name.startswith("acas:tenant:") and g.name != tgroup]
    if other:
        print("ERROR: " + email + " is already in another ACAS client group: " + ", ".join(other))
        print("One person = one business. Remove that group first if this is intended.")
        raise SystemExit(1)
    for g in groups:
        user.groups.add(Group.objects.get(name=g))
    print("EXISTING USER: added groups " + ", ".join(groups))
    send("You now have access to Axus Communications Analytics",
         "Hi " + first + ",\n\nYour Axus account now has access to Communications Analytics (call wallboards, dashboards and reports). Sign in with your existing Axus account:\n\n" + ACAS + "\n\nAxus Technologies",
         html_card("Communications Analytics is ready",
                   "Your Axus account now has access to Communications Analytics: live call wallboards, dashboards and reports for your phone system. Sign in with your existing Axus account.",
                   ACAS, "Open Communications Analytics"))
    raise SystemExit(0)

admin = (User.objects.filter(email__iexact="admin@axustechnologies.com").first()
         or User.objects.order_by("pk").first())
flow = Flow.objects.get(slug="axus-invitation")
iname = "invite-" + email.replace("@", "-at-").replace(".", "-")[:50]
Invitation.objects.filter(name=iname).delete()
inv = Invitation.objects.create(
    name=iname, flow=flow, created_by=admin, single_use=True,
    expires=timezone.now() + datetime.timedelta(days=7),
    fixed_data={"email": email, "name": name, "username": email,
                "attributes": {"invite_groups": groups}},
)
url = "https://id.hub.axustechnologies.com/if/flow/axus-invitation/?itoken=" + str(inv.pk)
send("You're invited to Axus Communications Analytics",
     "Hi " + first + ",\n\nAn account has been created for you on Axus Communications Analytics (call wallboards, dashboards and reports). Use the link below to set your password:\n\n" + url + "\n\nThis link is single-use and expires in 7 days. Afterwards sign in at " + ACAS + "\n\nAxus Technologies",
     html_card("You're invited to Communications Analytics",
               "An account has been created for you on Axus Communications Analytics: live call wallboards, dashboards and reports for your phone system. Set your password to get started. The link is single-use and expires in 7 days.",
               url, "Set up your account"))
print("NEW USER: invitation created | groups: " + ", ".join(groups))
print("URL=" + url)
PY
)
B64=$(printf '%s' "$PYCODE" | base64 -w0)
docker compose exec -e I_EMAIL="$EMAIL" -e I_NAME="$NAME" -e I_SLUG="$SLUG" -e B64PY="$B64" \
  -T authentik-server ak shell -c \
  'import base64, os; exec(base64.b64decode(os.environ["B64PY"]).decode())' 2>/dev/null

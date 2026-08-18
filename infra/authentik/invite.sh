#!/usr/bin/env bash
# One-step Axus invitation: creates an Authentik enrollment invitation with the
# right groups AND emails the recipient a branded set-up link (via the M365 relay
# already configured on Authentik). Groups are attached the moment they enroll
# (see reconcile-invite-groups.sh).
#
# Usage:
#   invite.sh <email> "<Full Name>" <observer|regular|admin|sysadmin> <org-slug>
#
# Example:
#   invite.sh jsmith@bcomhealth.org "John Smith" observer bcom
#   -> groups: app-insights, ain-role-observer, ain-org-bcom
#
# The org-slug must match an existing ain-org-<slug> group (see the Hub's
# Directory -> Groups). Unknown role/org fails fast without sending anything.
set -euo pipefail

EMAIL="${1:?usage: invite.sh <email> \"<Full Name>\" <role> <org-slug>}"
NAME="${2:?name required (quote it)}"
ROLE="${3:?role required: observer|regular|admin|sysadmin}"
ORG="${4:?org-slug required (e.g. bcom)}"

case "$ROLE" in
  observer|regular|admin|sysadmin) ;;
  *) echo "ERROR: role must be one of: observer regular admin sysadmin" >&2; exit 1 ;;
esac

cd /home/ubuntu/axus-platform/infra

PYCODE=$(cat <<'PY'
import os, datetime
from django.utils import timezone
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from authentik.flows.models import Flow
from authentik.core.models import User, Group
from authentik.stages.invitation.models import Invitation

email  = os.environ["INVITE_EMAIL"].strip()
name   = os.environ["INVITE_NAME"].strip()
role   = os.environ["INVITE_ROLE"].strip()
org    = os.environ["INVITE_ORG"].strip()
groups = ["app-insights", "ain-role-" + role, "ain-org-" + org]

missing = [g for g in groups if not Group.objects.filter(name=g).exists()]
if missing:
    print("ERROR: unknown group(s): " + ", ".join(missing))
    print("Create the group in the Hub first, or check the org-slug.")
    raise SystemExit(1)

if User.objects.filter(email__iexact=email).exists():
    print("ERROR: a user with " + email + " already exists in Axus. Adjust their groups directly instead of inviting.")
    raise SystemExit(1)

admin = (User.objects.filter(email__iexact="admin@axustechnologies.com").first()
         or User.objects.order_by("pk").first())
flow  = Flow.objects.get(slug="axus-invitation")

Invitation.objects.filter(name="invite-" + email.replace("@", "-at-").replace(".", "-")[:50]).delete()
inv = Invitation.objects.create(
    name="invite-" + email.replace("@", "-at-").replace(".", "-")[:50],
    flow=flow, created_by=admin, single_use=True,
    expires=timezone.now() + datetime.timedelta(days=7),
    fixed_data={"email": email, "name": name, "username": email,
                "attributes": {"invite_groups": groups}},
)
url = "https://id.hub.axustechnologies.com/if/flow/axus-invitation/?itoken=" + str(inv.pk)
first = (name.split(" ")[0] if name else "there")

subject = "You're invited to Axus"
text = (
    "Hi " + first + ",\n\n"
    "An account has been created for you on the Axus platform. "
    "Use the link below to set your password and sign in:\n\n" + url + "\n\n"
    "This link is single-use and expires in 7 days.\n\n"
    "If you weren't expecting this, you can ignore this email.\n\n"
    "— Axus Technologies"
)
html = (
'<div style="margin:0;padding:0;background:#f5f6f8;">'
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 12px;">'
'<tr><td align="center">'
'<table role="presentation" width="480" cellpadding="0" cellspacing="0" '
'style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;'
'font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;overflow:hidden;">'
'<tr><td style="height:4px;background:#ea580c;"></td></tr>'
'<tr><td style="padding:32px 36px 8px;">'
'<img src="https://axustechnologies.com/wp-content/themes/awi/img/axus-technologies-logo.png" '
'alt="Axus" height="30" style="display:block;border:0;margin-bottom:24px;">'
'<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827;">You\'re invited to Axus</h1>'
'<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#374151;">Hi ' + first + ',</p>'
'<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#374151;">'
'An account has been created for you on the Axus platform. Set your password to get started.</p>'
'</td></tr>'
'<tr><td style="padding:0 36px 28px;">'
'<a href="' + url + '" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;'
'font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">Set up your account</a>'
'</td></tr>'
'<tr><td style="padding:0 36px 32px;">'
'<p style="margin:0;font-size:13px;line-height:1.5;color:#9ca3af;">'
'This link is single-use and expires in 7 days. If you weren\'t expecting this, you can ignore this email.</p>'
'</td></tr>'
'<tr><td style="padding:16px 36px;background:#fafafa;border-top:1px solid #f0f0f0;">'
'<p style="margin:0;font-size:12px;color:#9ca3af;">Axus Technologies &middot; axustechnologies.com</p>'
'</td></tr>'
'</table></td></tr></table></div>'
)

msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [email])
msg.attach_alternative(html, "text/html")
sent = msg.send()
print("SENT" if sent else "NOT SENT", "->", email, "| groups:", ", ".join(groups))
print("URL=" + url)
PY
)
B64=$(printf '%s' "$PYCODE" | base64 -w0)

docker compose exec \
  -e INVITE_EMAIL="$EMAIL" -e INVITE_NAME="$NAME" -e INVITE_ROLE="$ROLE" -e INVITE_ORG="$ORG" -e B64PY="$B64" \
  -T authentik-server ak shell -c \
  'import base64, os; exec(base64.b64decode(os.environ["B64PY"]).decode())'

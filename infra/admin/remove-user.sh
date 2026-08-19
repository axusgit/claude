#!/usr/bin/env bash
# Fully remove a user from Axus — deletes the account from BOTH the Hub
# (Authentik) and Insights (AIN), plus any pending invitation. Irreversible.
#
# Run from a machine with the `hub` and `insights` SSH aliases.
# Usage: remove-user.sh <email>
set -euo pipefail

EMAIL="${1:?usage: remove-user.sh <email>}"
LOWER=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')

if [ "$LOWER" = "admin@axustechnologies.com" ]; then
  echo "Refusing to delete the Axus platform admin (admin@axustechnologies.com)." >&2
  exit 1
fi

echo "==> Hub (Authentik): removing $EMAIL"
PYHUB=$(cat <<'PY'
import os
from authentik.core.models import User
from authentik.stages.invitation.models import Invitation
email = os.environ["RM_EMAIL"]
qs = User.objects.filter(email__iexact=email)
print("   user:", (qs.delete() if qs.exists() else "not present"))
n = 0
for i in Invitation.objects.all():
    if str((i.fixed_data or {}).get("email", "")).lower() == email.lower():
        i.delete(); n += 1
print("   pending invites removed:", n)
PY
)
B64=$(printf '%s' "$PYHUB" | base64 -w0)
ssh hub "cd ~/axus-platform/infra && sudo docker compose exec -e RM_EMAIL='$EMAIL' -e B64PY='$B64' -T authentik-server ak shell -c 'import base64,os; exec(base64.b64decode(os.environ[\"B64PY\"]).decode())' 2>/dev/null"

echo "==> Insights (AIN): removing $EMAIL"
ssh insights "sudo docker exec -i insights-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA" <<SQL
do \$\$
declare uid uuid; adminid uuid;
begin
  select id into uid from auth.users where lower(email)=lower('$EMAIL');
  if uid is null then raise notice '   user: not present'; return; end if;
  select id into adminid from auth.users where lower(email)='admin@axustechnologies.com';
  -- granted_by is RESTRICT; hand any grants this user issued to admin@ first
  update public.user_org_access set granted_by=adminid where granted_by=uid;
  update public.user_features   set granted_by=adminid where granted_by=uid;
  delete from auth.users where id=uid;   -- CASCADEs roles/org-access/features
  raise notice '   user: deleted %', uid;
end \$\$;
SQL

echo "✓ $EMAIL fully removed from Axus."

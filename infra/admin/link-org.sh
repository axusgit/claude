#!/usr/bin/env bash
# Link an existing AIN organization to the Hub so invited users can be granted
# it. Creates the ain-org-<slug> group in Authentik and maps it to the AIN org.
# Run this AFTER creating the organization in the AIN admin UI (AIN needs the
# Meraki org id, so the org itself is made there).
#
# Run from a machine with the `hub` and `insights` SSH aliases.
# Usage: link-org.sh <slug> "<Organization name exactly as shown in AIN>"
# Example: link-org.sh acme "Acme Clinic"
set -euo pipefail

SLUG="${1:?usage: link-org.sh <slug> \"<Org name in AIN>\"}"
ORGNAME="${2:?org name required (exactly as shown in AIN)}"
GROUP="ain-org-${SLUG}"

echo "==> Looking up '$ORGNAME' in Insights…"
ORGID=$(ssh insights "sudo docker exec -i insights-db psql -U postgres -d postgres -tA" <<SQL
select id from public.organizations where org_name='$ORGNAME' limit 1;
SQL
)
ORGID=$(printf '%s' "$ORGID" | tr -d '[:space:]')
if [ -z "$ORGID" ]; then
  echo "ERROR: no organization named '$ORGNAME' in AIN." >&2
  echo "Create it in the AIN admin UI first, and match the name exactly." >&2
  exit 1
fi
echo "   org id: $ORGID"

echo "==> Hub (Authentik): ensuring group $GROUP exists…"
PYG=$(cat <<'PY'
import os
from authentik.core.models import Group
g, created = Group.objects.get_or_create(name=os.environ["GRP"])
print("   group:", "created" if created else "already exists")
PY
)
B64=$(printf '%s' "$PYG" | base64 -w0)
ssh hub "cd ~/axus-platform/infra && sudo docker compose exec -e GRP='$GROUP' -e B64PY='$B64' -T authentik-server ak shell -c 'import base64,os; exec(base64.b64decode(os.environ[\"B64PY\"]).decode())' 2>/dev/null"

echo "==> Insights (AIN): mapping $GROUP -> org…"
ssh insights "sudo docker exec -i insights-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA" <<SQL
insert into public.sso_org_groups (group_name, org_id) values ('$GROUP', '$ORGID')
on conflict (group_name) do update set org_id=excluded.org_id;
select '   mapped ' || group_name || ' -> ' || org_id from public.sso_org_groups where group_name='$GROUP';
SQL

echo "✓ '$ORGNAME' linked. Now invite people with:"
echo "    add-user.sh <email> \"<Name>\" <role> $SLUG"

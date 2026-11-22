#!/usr/bin/env bash
# Create the Authentik group for an ACAS client business: acas:tenant:<slug>.
# Create the client on the ACAS Clients page first (same slug).
# Run from a machine with the `hub` SSH alias.
# Usage: acas-link-tenant.sh <slug>
set -euo pipefail
SLUG="${1:?usage: acas-link-tenant.sh <slug>}"
case "$SLUG" in *[!a-z0-9-]*|"") echo "ERROR: slug must be lowercase letters, digits, dashes" >&2; exit 1;; esac
GROUP="acas:tenant:${SLUG}"
PYG=$(cat <<'PY'
import os
from authentik.core.models import Group
g, created = Group.objects.get_or_create(name=os.environ["GRP"])
print("group " + g.name + ": " + ("created" if created else "already exists"))
PY
)
B64=$(printf '%s' "$PYG" | base64 -w0)
ssh hub "cd ~/axus-platform/infra && sudo docker compose exec -e GRP='$GROUP' -e B64PY='$B64' -T authentik-server ak shell -c 'import base64,os; exec(base64.b64decode(os.environ[\"B64PY\"]).decode())' 2>/dev/null"
echo "Next: acas-add-user.sh <email> \"<Name>\" $SLUG   then turn client sign-in ON in ACAS > Clients."

#!/usr/bin/env bash
# Give a person read-only access to ONE client business in ACAS.
# New person: invitation + set-up email. Existing Hub account: groups added + notice email.
# Run from a machine with the `hub` SSH alias.
# Usage: acas-add-user.sh <email> "<Full Name>" <tenant-slug>
set -euo pipefail
[ $# -eq 3 ] || { echo 'usage: acas-add-user.sh <email> "<Full Name>" <tenant-slug>' >&2; exit 1; }
ssh hub "sudo ~/axus-platform/infra/authentik/invite-acas.sh '$1' '$2' '$3'"

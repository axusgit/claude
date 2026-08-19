#!/usr/bin/env bash
# Add a user to Axus: creates an Authentik invitation with the right groups and
# emails the person a branded set-up link. Access attaches automatically within
# a minute of enrollment. (Thin wrapper around the on-box invite.sh.)
#
# Run from a machine with the `hub` SSH alias (Andy's laptop, Git Bash).
# Usage:
#   add-user.sh <email> "<Full Name>" <observer|regular|admin|sysadmin> <org-slug>
# Example:
#   add-user.sh jsmith@bcomhealth.org "John Smith" observer bcom
set -euo pipefail

[ $# -eq 4 ] || {
  echo 'usage: add-user.sh <email> "<Full Name>" <observer|regular|admin|sysadmin> <org-slug>' >&2
  exit 1
}

ssh hub "sudo ~/axus-platform/infra/authentik/invite.sh '$1' '$2' '$3' '$4'"

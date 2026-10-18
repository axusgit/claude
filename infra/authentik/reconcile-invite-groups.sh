#!/usr/bin/env bash
# Assign per-invitation groups to newly-enrolled Authentik users.
#
# An invitation's fixed_data carries the desired groups as
# attributes.invite_groups; user_write merges that list onto the new user, but
# Authentik's flow engine can't assign the groups itself (a policy can't persist
# context["groups"], and the in-process post_save signal doesn't fire in the
# server's request path during enrollment). So this job — cron every 5 min —
# reads attributes.invite_groups, adds the matching groups, and clears the
# marker. Idempotent and safe: it only touches users that still carry the marker.
#
# Table is authentik_core_user_groups (user_id int, group_id uuid->group_uuid);
# renamed from authentik_core_user_ak_groups in the 2026.8.x schema.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Nothing to do unless a user still carries the marker -> avoids opening a psql
# connection every run (keeps steady-state Postgres connection pressure off).
pending=$(docker exec axus-postgres-1 psql -U axus -d authentik -tAc \
  "SELECT count(*) FROM authentik_core_user WHERE attributes ? 'invite_groups';" 2>/dev/null || echo 0)
[ "${pending:-0}" = "0" ] && exit 0

docker exec -i axus-postgres-1 psql -U axus -d authentik -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO authentik_core_user_groups (user_id, group_id)
SELECT u.id, g.group_uuid
FROM   authentik_core_user u
CROSS  JOIN LATERAL jsonb_array_elements_text(u.attributes -> 'invite_groups') AS gn(name)
JOIN   authentik_core_group g ON g.name = gn.name
WHERE  u.attributes ? 'invite_groups'
ON CONFLICT (user_id, group_id) DO NOTHING;

UPDATE authentik_core_user
SET    attributes = attributes - 'invite_groups'
WHERE  attributes ? 'invite_groups';
SQL

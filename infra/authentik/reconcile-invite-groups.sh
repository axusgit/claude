#!/usr/bin/env bash
# Assign per-invitation groups to newly-enrolled Authentik users.
#
# An invitation's fixed_data carries the desired groups as
# attributes.invite_groups; user_write merges that list onto the new user, but
# Authentik's flow engine can't assign the groups itself (a policy can't persist
# context["groups"], and the in-process post_save signal doesn't fire in the
# server's request path during enrollment). So this job — cron every minute —
# reads attributes.invite_groups, adds the matching groups, and clears the
# marker. Idempotent and safe: it only touches users that still carry the marker.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /home/ubuntu/axus-platform/infra

docker compose exec -T postgres psql -U axus -d authentik -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO authentik_core_user_ak_groups (user_id, group_id)
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

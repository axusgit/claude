# Authentik settings override (loaded via `_update_settings("data.user_settings")`).
# Mounted at /data so it imports as `data.user_settings`.
#
# Purpose: add plain bcrypt ($2a$/$2b$) validation so users migrated from apps
# that hash with plain bcrypt (e.g. Supabase/GoTrue — Axus Insights) can keep
# their EXACT existing password. bcrypt is appended LAST, so the default hasher
# for NEW passwords is unchanged (still PBKDF2); bcrypt is only ever used to
# verify a legacy hash, after which Authentik transparently re-hashes to PBKDF2.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
    "django.contrib.auth.hashers.BCryptPasswordHasher",
]

# --- Group-assigning invitations --------------------------------------------
# An invitation carries the desired groups in its fixed_data as
# attributes.invite_groups (user_write merges an "attributes" dict, so the list
# lands on the new user). A post_save signal registered here does NOT fire in
# the server's request-handling process during enrollment, so group assignment
# is done instead by a lightweight reconciliation job (authentik/reconcile-
# invite-groups.sh, cron every minute) that reads attributes.invite_groups,
# assigns the matching groups, and clears the marker. See axus-insights-hub-sso.

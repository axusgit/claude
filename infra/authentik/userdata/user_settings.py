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

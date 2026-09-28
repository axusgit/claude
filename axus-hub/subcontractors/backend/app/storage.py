"""Secure at-rest storage for uploaded compliance documents (W-9 and COI).

Per the project decision, ALL uploaded documents are encrypted at rest (not just
W-9), so the data volume never holds plaintext tax or insurance documents. Files
are written under an opaque, unguessable `stored_name`; the original filename is
kept only in the DB row for display. Downloads are always served through a
permission-gated route that decrypts on the fly — never a public/static path.

Encryption: Fernet (AES-128-CBC + HMAC-SHA256, authenticated) with a key from
`DOC_ENCRYPTION_KEY` (a Fernet key string). In production the key lives only in
infra/.env. If unset, a deterministic DEV key is used with a loud warning so
local dev works — never rely on that in production.

Allowed file types mirror the Axus Support Desk (ASD) attachment allowlist.
"""
import os
import base64
import hashlib
import secrets

from cryptography.fernet import Fernet

# Same allowlist as the ASD (support portal ALLOWED_ATTACHMENT_EXTS).
ALLOWED_EXTS = {
    ".doc", ".pdf", ".jpg", ".jpeg", ".gif", ".png", ".xls", ".docx", ".xlsx",
    ".txt", ".pcapng", ".eml", ".pcap", ".wav", ".csv", ".mp4", ".mp3", ".heic",
}

MAX_ATTACHMENT_BYTES = int(os.getenv("MAX_ATTACHMENT_MB", "25")) * 1024 * 1024

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _load_key() -> bytes:
    raw = os.getenv("DOC_ENCRYPTION_KEY")
    if raw:
        return raw.encode() if isinstance(raw, str) else raw
    # Deterministic DEV-ONLY fallback so local dev runs without a configured key.
    print(
        "[storage] WARNING: DOC_ENCRYPTION_KEY not set — using an insecure DEV key. "
        "Set DOC_ENCRYPTION_KEY in production (generate with "
        "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`).",
        flush=True,
    )
    digest = hashlib.sha256(b"axus-subcontractors-dev-key").digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_load_key())


def ext_of(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower()


def is_allowed(filename: str) -> bool:
    return ext_of(filename) in ALLOWED_EXTS


def save_encrypted(content: bytes) -> str:
    """Encrypt `content` and write it under a new opaque stored_name; return that
    name (what goes in the DB row). Caller validates extension/size first."""
    stored_name = secrets.token_hex(16) + ".enc"
    path = os.path.join(UPLOAD_DIR, stored_name)
    with open(path, "wb") as f:
        f.write(_fernet.encrypt(content))
    return stored_name


def load_decrypted(stored_name: str) -> bytes:
    """Read and decrypt a stored document. Raises FileNotFoundError if missing."""
    path = os.path.join(UPLOAD_DIR, stored_name)
    with open(path, "rb") as f:
        return _fernet.decrypt(f.read())

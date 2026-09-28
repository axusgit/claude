"""Permanent internal subcontractor IDs (AXV-000001).

The human-facing ID is derived from the row's integer primary key, formatted as
`AXV-` + 6-digit zero-padded number. IDs are permanent and unique; gaps (from a
rolled-back insert) are acceptable since only uniqueness and stability matter,
never contiguity. We deliberately do NOT use company name or email as the
identifier (per the spec).
"""

PUBLIC_ID_PREFIX = "AXV-"


def format_public_id(seq: int) -> str:
    return f"{PUBLIC_ID_PREFIX}{seq:06d}"

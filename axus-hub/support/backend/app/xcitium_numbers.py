"""Map the human-facing Xcitium "Ticket Number" onto mirrored tickets.

The Xcitium clientapi only ever returns the internal ``ticketId`` (e.g. 3595),
never the long display number shown in the Xcitium web UI (e.g. 8843278). That
number is only obtainable from a CSV export of the ticket list, so this module
matches each CSV row back to a mirror ticket (by create time + subject/org/
reporter) and records the display number on it.

Matching is deliberately conservative: a row is only assigned when it resolves to
exactly one mirror ticket with a strong score. Unmatched rows are reported back so
the caller can see what didn't map (usually a ticket not yet in the mirror).
"""
import csv
import io
import re
from datetime import datetime, timedelta, timezone

from app.models.xcitium import XcitiumTicket
from app.models.ticket import Ticket
from app.models.client import Client

REQUIRED_COLUMNS = {"Ticket", "Subject", "Customer", "From", "Create Date"}


def _et_to_utc(s: str):
    """Parse a Xcitium CSV 'Create Date' (US Eastern, e.g. '09/23/2026 8:13 am')
    into an aware UTC datetime. US Eastern DST runs ~mid-Mar..early-Nov; approximate
    by month (EST/-5 for Jan/Feb/Dec, EDT/-4 otherwise) which is exact for all
    real-world ticket dates except the few hours around a DST switch."""
    dt = datetime.strptime(s.strip(), "%m/%d/%Y %I:%M %p")
    off = 5 if dt.month in (1, 2, 12) else 4
    return (dt + timedelta(hours=off)).replace(tzinfo=timezone.utc)


def _norm(s: str) -> str:
    s = (s or "").replace("�", "")          # drop replacement chars
    s = re.sub(r"\.\.\.\s*$", "", s)              # drop trailing "..." (CSV truncation)
    return s.strip().lower()


def parse_rows(data: bytes):
    """Decode + parse the CSV. Raises ValueError if the expected columns are absent."""
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    cols = set(reader.fieldnames or [])
    missing = REQUIRED_COLUMNS - cols
    if missing:
        raise ValueError(f"CSV is missing column(s): {', '.join(sorted(missing))}")
    return list(reader)


def apply_numbers(db, data: bytes) -> dict:
    """Match CSV rows to mirror tickets and set display_number. Commits.

    Returns a summary: rows, matched, updated (changed), skipped_no_number, and a
    list of unmatched rows ({number, subject}). Idempotent — re-running the same CSV
    updates nothing new."""
    rows = parse_rows(data)

    client_name = {c.id: (c.company_name or "") for c in db.query(Client).all()}

    def _fields(obj):
        """(subject, org, reporter) lower-cased, for a mirror row or a native ticket."""
        if isinstance(obj, XcitiumTicket):
            return (obj.subject or "").lower(), (obj.organization_name or "").lower(), (obj.username or "").lower()
        # native promoted Xcitium ticket
        return (obj.title or "").lower(), client_name.get(obj.client_id, "").lower(), ""

    def _created(obj):
        return obj.create_date if isinstance(obj, XcitiumTicket) else obj.created_at

    # Index candidates (mirror rows + promoted native Xcitium tickets still tagged
    # X-...) by UTC create-minute for fast lookup.
    by_minute = {}
    def _index(obj):
        cd = _created(obj)
        if not cd:
            return
        if cd.tzinfo is None:
            cd = cd.replace(tzinfo=timezone.utc)
        by_minute.setdefault(cd.replace(second=0, microsecond=0), []).append(obj)

    for t in db.query(XcitiumTicket).all():
        _index(t)
    for t in (db.query(Ticket)
              .filter(Ticket.origin == "xcitium", Ticket.reference.like("X-%")).all()):
        _index(t)

    matched = updated = skipped = 0
    unmatched = []
    used_numbers = set()

    for r in rows:
        num = (r.get("Ticket") or "").strip()
        if not num:
            skipped += 1
            continue
        subj, org, frm = _norm(r.get("Subject")), _norm(r.get("Customer")), _norm(r.get("From"))
        try:
            utc = _et_to_utc(r.get("Create Date") or "")
        except (ValueError, TypeError):
            unmatched.append({"number": num, "subject": r.get("Subject", "")})
            continue
        key = utc.replace(second=0, microsecond=0)

        cands = []
        for dm in (-2, -1, 0, 1, 2):
            cands += by_minute.get(key + timedelta(minutes=dm), [])

        def score(obj):
            ts, to, tu = _fields(obj)
            s = 0
            if subj and (ts.startswith(subj) or subj.startswith(ts[:len(subj)])):
                s += 2
            if org and (to.startswith(org) or org.startswith(to[:len(org)])):
                s += 1
            if frm and tu == frm:
                s += 1
            return s

        ranked = sorted(cands, key=score, reverse=True)
        best = [t for t in ranked if score(t) >= 2]
        # unique winner: exactly one candidate reaches the threshold (or a clear top)
        if len(best) == 1 or (len(best) > 1 and score(best[0]) > score(best[1])):
            t = best[0]
            matched += 1
            if num not in used_numbers:
                if isinstance(t, XcitiumTicket):
                    if t.display_number != num:
                        t.display_number = num
                        used_numbers.add(num)
                        updated += 1
                else:  # promoted native ticket — relabel its reference
                    newref = f"X-{num}"
                    if t.reference != newref:
                        t.reference = newref
                        used_numbers.add(num)
                        updated += 1
        else:
            unmatched.append({"number": num, "subject": r.get("Subject", "")})

    db.commit()
    return {
        "rows": len(rows),
        "matched": matched,
        "updated": updated,
        "skipped_no_number": skipped,
        "unmatched": unmatched,
    }

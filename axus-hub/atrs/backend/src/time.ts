// Time helpers. Entries carry wall-clock start/end as entered by the worker;
// hours are derived here so the client can't send an inconsistent total.

// "HH:MM" (24h) → minutes since midnight, or null if malformed.
export function parseHm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Normalize to canonical "HH:MM" (zero-padded) for storage/display.
export function normalizeHm(v: string): string | null {
  const mins = parseHm(v);
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Hours between start and end. An end at or before the start is treated as the
// next day (overnight shift), so 22:00 → 02:00 = 4h. Returns null if either is
// malformed, or 0 if they are identical (rejected upstream as a zero-length day).
export function hoursBetween(start: string, end: string): number | null {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === null || e === null) return null;
  let diff = e - s;
  if (diff <= 0) diff += 24 * 60; // overnight
  return Math.round((diff / 60) * 100) / 100;
}

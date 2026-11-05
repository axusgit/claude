import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a numeric hours value compactly: 3 → "3", 3.5 → "3.5", 3.25 → "3.25".
export function fmtHours(h: number): string {
  return (Math.round(h * 100) / 100).toString();
}

// "YYYY-MM-DD" → "Mon, Nov 3" (parsed as a local calendar date, no tz shift).
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Today's local calendar date as "YYYY-MM-DD".
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday of the current week (local), as "YYYY-MM-DD" — the default period start.
export function weekStartIso(): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

import { useState } from "react";

export type SortDir = "asc" | "desc";

// Small, shared sort state used by the table pages (Documents, Companies,
// Contacts, Recycle Bin, Archive). Clicking a column sorts by it ascending;
// clicking the same column again flips the direction.
export function useSort<K extends string>(initialKey: K, initialDir: SortDir = "asc") {
  const [key, setKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);
  function toggle(k: K) {
    if (k === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setKey(k);
      setDir("asc");
    }
  }
  return { key, dir, toggle };
}

// Compare two cell values consistently: numbers numerically, everything else as
// natural-order strings. Blank/null values always sort to the end regardless of
// direction, so empty cells never crowd the top.
export function cmp(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

// Apply the sort direction to a comparator result. Blank-last handling in cmp()
// deliberately isn't flipped — see cmp() above.
export function dirCmp(a: unknown, b: unknown, dir: SortDir): number {
  const n = cmp(a, b);
  if (n === 0) return 0;
  // Keep blanks last in both directions: if exactly one side is blank, cmp has
  // already placed it last, so don't negate that decision.
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty !== bEmpty) return n;
  return dir === "asc" ? n : -n;
}

// Signature-block detection from a PDF page's text + vector drawing. Pure
// functions (no React) so they can be unit-tested against real PDFs in Node.
import * as pdfjsLib from "pdfjs-dist";
import type { FieldType, SignField, SignSlot } from "@/lib/api";

// Fallback size (normalized) when a click lands somewhere with no text line.
export const FIELD_DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 0.24, h: 0.03, label: "Signature" },
  name: { w: 0.24, h: 0.026, label: "Name" },
  title: { w: 0.16, h: 0.026, label: "Title" },
  initials: { w: 0.1, h: 0.03, label: "Initials" },
  date: { w: 0.16, h: 0.026, label: "Date" },
  text: { w: 0.22, h: 0.026, label: "Text" },
  checkbox: { w: 0.02, h: 0.016, label: "Check" },
  select: { w: 0.22, h: 0.026, label: "Select" },
};

// A text run from the PDF (a label like "Signature: ______", normalized coords).
export interface Run {
  x0: number;
  x1: number;
  baseline: number;
  height: number;
  str: string;
}

// A drawn horizontal rule (the blank "line" you sign on), normalized coords.
// Many templates draw the fill-in line as a graphic (not text underscores), so
// we read the page's vector ops to find them and snap fields onto them.
export interface Rule {
  y: number;
  x0: number;
  x1: number;
}

// Extract horizontal rule lines from a page's drawing operators, tracking the
// CTM through save/restore/transform so path coordinates map to device space.
export async function detectRules(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }> },
  viewport: { transform: number[]; width: number; height: number; scale: number },
): Promise<Rule[]> {
  const W = viewport.width;
  const H = viewport.height;
  let ops: { fnArray: number[]; argsArray: unknown[] };
  try {
    ops = await page.getOperatorList();
  } catch {
    return [];
  }
  let ctm = viewport.transform.slice();
  const stack: number[][] = [];
  const segs: Rule[] = [];
  const dev = (x: number, y: number) => pdfjsLib.Util.applyTransform([x, y], ctm);
  const OPS = pdfjsLib.OPS;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = pdfjsLib.Util.transform(ctm, ops.argsArray[i] as number[]);
    else if (fn === OPS.constructPath) {
      const a = ops.argsArray[i] as [number[], number[]];
      const pathOps = a[0];
      const co = a[1];
      let cx = 0;
      let cy = 0;
      let k = 0;
      for (const op of pathOps) {
        if (op === OPS.moveTo) {
          cx = co[k++];
          cy = co[k++];
        } else if (op === OPS.lineTo) {
          const nx = co[k++];
          const ny = co[k++];
          if (Math.abs(ny - cy) < 1.5 && Math.abs(nx - cx) > 15) {
            const p0 = dev(cx, cy);
            const p1 = dev(nx, ny);
            segs.push({ y: p0[1] / H, x0: Math.min(p0[0], p1[0]) / W, x1: Math.max(p0[0], p1[0]) / W });
          }
          cx = nx;
          cy = ny;
        } else if (op === OPS.rectangle) {
          const rx = co[k++];
          const ry = co[k++];
          const rw = co[k++];
          const rh = co[k++];
          if (Math.abs(rh) < 2 && Math.abs(rw) > 15) {
            const p = dev(rx, ry);
            segs.push({ y: p[1] / H, x0: p[0] / W, x1: (p[0] + rw * viewport.scale) / W });
          }
        } else {
          k += 2;
        }
      }
    }
  }
  // Merge collinear segments (dashed / split rules) into contiguous lines.
  segs.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const rules: Rule[] = [];
  for (const s of segs) {
    const r = rules.find(
      (r) => Math.abs(r.y - s.y) < 0.004 && s.x0 <= r.x1 + 0.02 && s.x1 >= r.x0 - 0.02,
    );
    if (r) {
      r.x0 = Math.min(r.x0, s.x0);
      r.x1 = Math.max(r.x1, s.x1);
    } else {
      rules.push({ y: s.y, x0: s.x0, x1: s.x1 });
    }
  }
  return rules;
}

export function computeRuns(
  tc: { items: unknown[] },
  viewport: { transform: number[]; width: number; height: number; scale: number },
): Run[] {
  const W = viewport.width;
  const H = viewport.height;
  const runs: Run[] = [];
  for (const raw of tc.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const t = pdfjsLib.Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(t[2], t[3]) || (it.height ?? 0) * viewport.scale;
    runs.push({
      x0: t[4] / W,
      x1: (t[4] + (it.width ?? 0) * viewport.scale) / W,
      baseline: t[5] / H,
      height: h / H,
      str: it.str,
    });
  }
  return runs;
}

// Detect signature-block fields on one page from its text runs — the same
// blank-after-label logic as click-to-place, applied to standard labels
// (Signature / Date / Printed Name / Title). Used to AUTO-PLACE on uploads.
export function detectFields(runs: Run[], rules: Rule[], pageNumber: number): SignField[] {
  const out: SignField[] = [];
  const mk = (type: SignField["type"], startFrac: number, endFrac: number, r: Run): SignField => {
    const runW = r.x1 - r.x0;
    const x = Math.min(r.x0 + runW * startFrac + 0.004, r.x1 - 0.03);
    // Use the blank width if the underscores share the label's run; otherwise
    // (label-only run, blanks in a separate run) fall back to a sensible width.
    const wRaw = r.x0 + runW * endFrac - x;
    const w = Math.min(Math.max(wRaw, FIELD_DEFAULTS[type].w), 1 - x - 0.01);
    const h = Math.min(r.height * 1.7, 0.06);
    const y = Math.min(Math.max(r.baseline - h, 0), 1 - h);
    return { type, page: pageNumber, x, y, w, h };
  };
  // Preferred: snap the field onto the drawn underline rule that sits at the
  // label's baseline and extends to its right (label + separate-graphic line —
  // the common Word/PDF signature block). Returns null when no rule fits, so
  // templates whose blanks are text underscores fall back to mk().
  const onRule = (type: SignField["type"], r: Run): SignField | null => {
    let best: Rule | null = null;
    let bd = Infinity;
    for (const rl of rules) {
      const dy = rl.y - r.baseline; // rule at (just below) the label baseline
      if (dy < -0.006 || dy > 0.02) continue;
      if (rl.x1 < r.x1 + 0.01) continue; // must extend right of the label
      const d = Math.abs(dy) + Math.max(0, rl.x0 - r.x1) * 0.1;
      if (d < bd) {
        bd = d;
        best = rl;
      }
    }
    if (!best) return null;
    const x = Math.max(r.x1 + 0.008, best.x0);
    const w = Math.max(best.x1 - x, 0.05);
    const h = Math.min(r.height * 1.5, 0.03);
    const y = Math.min(Math.max(best.y - h, 0), 1 - h);
    return { type, page: pageNumber, x, y, w, h };
  };
  const place = (type: SignField["type"], startFrac: number, endFrac: number, r: Run) =>
    onRule(type, r) ?? mk(type, startFrac, endFrac, r);
  for (const r of runs) {
    const s = r.str;
    const len = s.length || 1;
    const low = s.toLowerCase();
    const sig = low.match(/signature\s*:/);
    const date = low.match(/date\s*:/);
    const name = low.match(/print(?:ed)?\s*name\s*:/);
    const title = low.match(/title\s*:/);
    if (sig) {
      const start = (sig.index ?? 0) + sig[0].length;
      const end = date && (date.index ?? 0) > (sig.index ?? 0) ? (date.index ?? len) : len;
      out.push(place("signature", start / len, end / len, r));
    }
    if (date) out.push(place("date", ((date.index ?? 0) + date[0].length) / len, 1, r));
    if (name) out.push(place("name", ((name.index ?? 0) + name[0].length) / len, 1, r));
    if (title) out.push(place("title", ((title.index ?? 0) + title[0].length) / len, 1, r));
  }
  markAxus(runs, out);
  return out;
}

// Flag the signature that belongs to AXUS's block: the one sitting just below
// a short heading naming Axus ("AXUS TECHNOLOGIES, LLC" over the right-hand
// column, or "Axus Authorized Person" over the lower stacked block). Long runs
// (body text such as "Authorized representatives of Customer and Axus…",
// running headers/footers) are ignored, and the heading must be above the
// signature and in its column, so the customer's block is never picked.
function markAxus(runs: Run[], fields: SignField[]) {
  const sigs = fields.filter((f) => f.type === "signature");
  for (const h of runs) {
    const s = h.str.trim();
    if (!/axus/i.test(s) || s.length > 60) continue;
    let best: SignField | null = null;
    let bd = Infinity;
    for (const sig of sigs) {
      const dy = sig.y + sig.h - h.baseline; // > 0 ⇔ signature below the heading
      if (dy < 0.005 || dy > 0.14) continue;
      if (h.x0 > sig.x + 0.05 || h.x0 < sig.x - 0.25) continue; // same column
      const d = dy + Math.abs(sig.x - h.x0) * 0.5;
      if (d < bd) {
        bd = d;
        best = sig;
      }
    }
    if (best) best.axus = true;
  }
}

// Axus's own signer fields for in-app "Sign as Axus": the slot flagged as
// Axus's (else, with two or more blocks, the last one — Axus signs second), with
// ONE each of signature / name / title / date on that slot's page. Returns []
// when there's no Axus block (e.g. a quote with only a customer block, or a
// scan with no text layer) — staff then place fields by hand.
export function axusSlotFields(slots: SignSlot[]): SignField[] {
  const slot = slots.find((s) => s.axus) ?? (slots.length >= 2 ? slots[slots.length - 1] : undefined);
  const sig = slot?.fields.find((f) => f.type === "signature");
  if (!slot || !sig) return [];
  const out: SignField[] = [sig];
  for (const type of ["name", "title", "date"] as const) {
    const cand = slot.fields
      .filter((f) => f.type === type && f.page === sig.page)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];
    if (cand) out.push(cand);
  }
  return out;
}

// Group detected fields into signer slots — one per "Signature:". Each
// date/name/title is assigned to the signature it belongs to by COLUMN (nearest
// in x) preferring the signature above it, so side-by-side two-signer blocks
// (Customer | Axus) group correctly instead of the earlier vertical-only scan
// that lumped a whole second column onto one signer. Slots are ordered
// left-to-right so signer 1 = leftmost block.
export function assembleSlots(all: SignField[]): SignSlot[] {
  const sigs = all
    .filter((f) => f.type === "signature")
    .sort((a, b) => a.page - b.page || a.x - b.x || a.y - b.y);
  if (!sigs.length) return [];
  const slots = sigs.map((s) => ({ sig: s, fields: [s] as SignField[] }));
  for (const f of all) {
    if (f.type === "signature") continue;
    let best: (typeof slots)[number] | null = null;
    let bd = Infinity;
    for (const slot of slots) {
      if (slot.sig.page !== f.page) continue;
      const colDist = Math.abs(slot.sig.x - f.x);
      const above = f.y >= slot.sig.y - 0.005; // signature sits above the field
      const d = colDist + (above ? f.y - slot.sig.y : 5);
      if (d < bd) {
        bd = d;
        best = slot;
      }
    }
    (best ?? slots[0]).fields.push(f);
  }
  return slots.map((s, i) =>
    s.sig.axus
      ? { role: "Axus Technologies", fields: s.fields, axus: true }
      : { role: `Signer ${i + 1}`, fields: s.fields },
  );
}


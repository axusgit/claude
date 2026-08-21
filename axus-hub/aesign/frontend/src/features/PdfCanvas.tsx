import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { X } from "lucide-react";
import type { Field, FieldType, Recipient, SignField, SignSlot } from "@/lib/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const TARGET_WIDTH = 820;

// Fallback size (normalized) when a click lands somewhere with no text line.
export const FIELD_DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 0.24, h: 0.03, label: "Signature" },
  name: { w: 0.24, h: 0.026, label: "Name" },
  title: { w: 0.16, h: 0.026, label: "Title" },
  initials: { w: 0.1, h: 0.03, label: "Initials" },
  date: { w: 0.16, h: 0.026, label: "Date" },
  text: { w: 0.22, h: 0.026, label: "Text" },
};

// A text run from the PDF (a label like "Signature: ______", normalized coords).
interface Run {
  x0: number;
  x1: number;
  baseline: number;
  height: number;
  str: string;
}

function computeRuns(
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
function detectFields(runs: Run[], pageNumber: number): SignField[] {
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
      out.push(mk("signature", start / len, end / len, r));
    }
    if (date) out.push(mk("date", ((date.index ?? 0) + date[0].length) / len, 1, r));
    if (name) out.push(mk("name", ((name.index ?? 0) + name[0].length) / len, 1, r));
    if (title) out.push(mk("title", ((title.index ?? 0) + title[0].length) / len, 1, r));
  }
  return out;
}

// Group detected fields into signer slots. A new slot starts at each
// "Signature:"; date/name/title after it belong to that block. Slots without a
// signature are dropped (avoids stray "Effective Date:" etc.).
function assembleSlots(all: SignField[]): SignSlot[] {
  const sorted = [...all].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const slots: SignSlot[] = [];
  let cur: SignField[] | null = null;
  for (const f of sorted) {
    if (f.type === "signature") {
      cur = [f];
      slots.push({ role: `Signer ${slots.length + 1}`, fields: cur });
    } else if (cur) {
      cur.push(f);
    }
  }
  return slots.filter((s) => s.fields.some((f) => f.type === "signature"));
}

interface PdfCanvasProps {
  url: string;
  fields: Field[];
  recipients: Recipient[];
  colorFor: (recipientId: string | null | undefined) => string;
  labelFor: (recipientId: string | null | undefined) => string;
  activeTool: FieldType | null;
  activeRecipientId: string | null;
  onAddField: (field: Field) => void;
  onUpdateField: (index: number, patch: Partial<Field>) => void;
  onDeleteField: (index: number) => void;
  onDetectLayout?: (slots: SignSlot[]) => void;
}

export function PdfCanvas(props: PdfCanvasProps) {
  const { url, onDetectLayout } = props;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageDet = useRef<Record<number, SignField[]>>({});

  function handlePageDetected(page: number, detected: SignField[]) {
    pageDet.current[page] = detected;
    onDetectLayout?.(assembleSlots(Object.values(pageDet.current).flat()));
  }

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    pageDet.current = {};
    const task = pdfjsLib.getDocument(url);
    task.promise.then(
      (pdf) => {
        if (cancelled) return;
        setDoc(pdf);
        setNumPages(pdf.numPages);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF");
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  if (error) return <div className="p-8 text-center text-sm text-red-600">{error}</div>;
  if (!doc) return <div className="p-8 text-center text-sm text-muted">Loading document…</div>;

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {Array.from({ length: numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} pageNumber={i + 1} onPageDetected={handlePageDetected} {...props} />
      ))}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  fields,
  colorFor,
  labelFor,
  activeTool,
  activeRecipientId,
  onAddField,
  onUpdateField,
  onDeleteField,
  onPageDetected,
}: PdfCanvasProps & {
  doc: PDFDocumentProxy;
  pageNumber: number;
  onPageDetected: (page: number, detected: SignField[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_WIDTH / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setSize({ w: viewport.width, h: viewport.height });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        /* cancelled */
      }
      try {
        const tc = await page.getTextContent();
        if (!cancelled) {
          const rs = computeRuns(tc, viewport);
          setRuns(rs);
          onPageDetected(pageNumber, detectFields(rs, pageNumber));
        }
      } catch {
        /* no text layer */
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [doc, pageNumber]);

  // Click → auto-place a field. If the click is on a labeled line
  // ("Signature: ____"), fill the blank after the label; otherwise drop a
  // default-sized field at the click.
  function placeFieldAt(cx: number, cy: number): Field | null {
    if (!activeTool) return null;
    // Find the labeled run the click sits on/above (baseline just below click).
    let best: Run | null = null;
    let bestD = Infinity;
    for (const r of runs) {
      if (cx < r.x0 - 0.006 || cx > r.x1 + 0.006) continue;
      const dy = r.baseline - cy; // >0 when the line is below the click
      if (dy < -1.2 * r.height || dy > 3 * r.height) continue;
      const d = Math.abs(dy);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }

    if (best) {
      const s = best.str;
      const uIdx = s.indexOf("_");
      let startFrac: number;
      if (uIdx >= 0) startFrac = uIdx / s.length;
      else {
        const ci = s.indexOf(":");
        startFrac = ci >= 0 ? Math.min((ci + 2) / s.length, 0.9) : 0;
      }
      const runW = best.x1 - best.x0;
      const x = Math.min(best.x0 + runW * startFrac + 0.004, best.x1 - 0.03);
      const w = Math.max(best.x1 - x, 0.03);
      const h = Math.min(best.height * 1.7, 0.06);
      const y = Math.min(Math.max(best.baseline - h, 0), 1 - h);
      return { type: activeTool, page: pageNumber, x, y, w, h, recipient_id: activeRecipientId, required: true };
    }

    // No text line here — drop a default field centered on the click.
    const def = FIELD_DEFAULTS[activeTool];
    const x = Math.min(Math.max(cx - def.w / 2, 0), 1 - def.w);
    const y = Math.min(Math.max(cy - def.h / 2, 0), 1 - def.h);
    return { type: activeTool, page: pageNumber, x, y, w: def.w, h: def.h, recipient_id: activeRecipientId, required: true };
  }

  function handleClick(e: React.MouseEvent) {
    if (!activeTool || !size) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const field = placeFieldAt(cx, cy);
    if (field) onAddField(field);
  }

  return (
    <div
      className="relative border border-line bg-white shadow-sm"
      style={{ width: size?.w ?? TARGET_WIDTH, height: size?.h ?? TARGET_WIDTH * 1.29 }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={overlayRef}
        className="absolute inset-0"
        style={{ cursor: activeTool ? "crosshair" : "default" }}
        onClick={handleClick}
      >
        {size &&
          fields.map((f, gi) =>
            f.page === pageNumber ? (
              <FieldBox
                key={f.id ?? gi}
                field={f}
                pageSize={size}
                color={colorFor(f.recipient_id)}
                label={labelFor(f.recipient_id)}
                onMove={(x, y) => onUpdateField(gi, { x, y })}
                onResize={(w, h) => onUpdateField(gi, { w, h })}
                onDelete={() => onDeleteField(gi)}
              />
            ) : null,
          )}
      </div>
    </div>
  );
}

function FieldBox({
  field,
  pageSize,
  color,
  label,
  onMove,
  onResize,
  onDelete,
}: {
  field: Field;
  pageSize: { w: number; h: number };
  color: string;
  label: string;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onDelete: () => void;
}) {
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resize = useRef<
    { startX: number; startY: number; origW: number; origH: number; mode: "r" | "b" | "c" } | null
  >(null);

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: field.x, origY: field.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / pageSize.w;
    const dy = (e.clientY - drag.current.startY) / pageSize.h;
    onMove(
      Math.min(Math.max(drag.current.origX + dx, 0), 1 - field.w),
      Math.min(Math.max(drag.current.origY + dy, 0), 1 - field.h),
    );
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  function onHandleDown(e: React.PointerEvent, mode: "r" | "b" | "c") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resize.current = { startX: e.clientX, startY: e.clientY, origW: field.w, origH: field.h, mode };
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!resize.current) return;
    e.stopPropagation();
    const dx = (e.clientX - resize.current.startX) / pageSize.w;
    const dy = (e.clientY - resize.current.startY) / pageSize.h;
    let w = field.w;
    let h = field.h;
    if (resize.current.mode !== "b") w = Math.max(0.02, Math.min(resize.current.origW + dx, 1 - field.x));
    if (resize.current.mode !== "r") h = Math.max(0.01, Math.min(resize.current.origH + dy, 1 - field.y));
    onResize(w, h);
  }
  function onHandleUp(e: React.PointerEvent) {
    resize.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  const h = field.h * pageSize.h;
  const handle = "absolute hidden bg-white group-hover:block";
  return (
    <div
      className="group absolute rounded-sm font-medium select-none"
      style={{
        left: field.x * pageSize.w,
        top: field.y * pageSize.h,
        width: field.w * pageSize.w,
        height: h,
        border: `1.5px solid ${color}`,
        background: `${color}22`,
        color,
        cursor: "move",
        fontSize: Math.max(8, Math.min(h * 0.62, 12)),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`${label} — ${field.type}`}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1">
        <span className="truncate leading-none">{FIELD_DEFAULTS[field.type].label}</span>
      </span>
      <button
        className="absolute -right-2 -top-2 hidden h-4 w-4 place-items-center rounded-full bg-white text-red-600 shadow group-hover:grid"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove field"
      >
        <X className="h-3 w-3" />
      </button>
      <span
        className={`${handle} right-[-3px] top-1/2 h-4 w-1.5 -translate-y-1/2 rounded`}
        style={{ border: `1px solid ${color}`, cursor: "ew-resize" }}
        onPointerDown={(e) => onHandleDown(e, "r")}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
      <span
        className={`${handle} bottom-[-3px] left-1/2 h-1.5 w-4 -translate-x-1/2 rounded`}
        style={{ border: `1px solid ${color}`, cursor: "ns-resize" }}
        onPointerDown={(e) => onHandleDown(e, "b")}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
      <span
        className={`${handle} bottom-[-4px] right-[-4px] h-2.5 w-2.5 rounded-sm`}
        style={{ border: `1px solid ${color}`, cursor: "nwse-resize" }}
        onPointerDown={(e) => onHandleDown(e, "c")}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
    </div>
  );
}

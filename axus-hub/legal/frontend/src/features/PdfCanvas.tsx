import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { X } from "lucide-react";
import type { Field, FieldType, Recipient } from "@/lib/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const TARGET_WIDTH = 820;

// Default size (normalized) when a field is click-dropped rather than drawn.
// Heights are deliberately thin so a field sits on a line without covering the
// lines above/below; drawing a box overrides these.
export const FIELD_DEFAULTS: Record<FieldType, { w: number; h: number; label: string }> = {
  signature: { w: 0.24, h: 0.05, label: "Signature" },
  name: { w: 0.24, h: 0.028, label: "Name Lastname" },
  initials: { w: 0.1, h: 0.045, label: "Initials" },
  date: { w: 0.16, h: 0.026, label: "Date" },
  text: { w: 0.22, h: 0.026, label: "Text" },
  checkbox: { w: 0.025, h: 0.018, label: "✓" },
};

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
}

export function PdfCanvas(props: PdfCanvasProps) {
  const { url } = props;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
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
        <PdfPage key={i} doc={doc} pageNumber={i + 1} {...props} />
      ))}
    </div>
  );
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
}: PdfCanvasProps & { doc: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draw, setDraw] = useState<Rect | null>(null);
  const drawing = useRef(false);

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

  function toNorm(e: React.PointerEvent): { nx: number; ny: number } {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      nx: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      ny: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function onDown(e: React.PointerEvent) {
    if (!activeTool || !size) return;
    overlayRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { nx, ny } = toNorm(e);
    setDraw({ x0: nx, y0: ny, x1: nx, y1: ny });
  }
  function onMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    const { nx, ny } = toNorm(e);
    setDraw((d) => (d ? { ...d, x1: nx, y1: ny } : d));
  }
  function onUp(e: React.PointerEvent) {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      overlayRef.current!.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const d = draw;
    setDraw(null);
    if (!d || !activeTool) return;
    const def = FIELD_DEFAULTS[activeTool];
    let x = Math.min(d.x0, d.x1);
    let y = Math.min(d.y0, d.y1);
    let w = Math.abs(d.x1 - d.x0);
    let h = Math.abs(d.y1 - d.y0);
    // A tiny drag counts as a click → drop a default-sized field at the point.
    if (w < 0.02 || h < 0.008) {
      w = def.w;
      h = def.h;
      x = Math.min(Math.max(d.x0 - w / 2, 0), 1 - w);
      y = Math.min(Math.max(d.y0 - h / 2, 0), 1 - h);
    } else {
      x = Math.min(x, 1 - w);
      y = Math.min(y, 1 - h);
    }
    onAddField({
      type: activeTool,
      page: pageNumber,
      x,
      y,
      w,
      h,
      recipient_id: activeRecipientId,
      required: true,
    });
  }

  const previewColor = colorFor(activeRecipientId);

  return (
    <div
      className="relative border border-line bg-white shadow-sm"
      style={{ width: size?.w ?? TARGET_WIDTH, height: size?.h ?? TARGET_WIDTH * 1.29 }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={overlayRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: activeTool ? "crosshair" : "default" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
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
                onDelete={() => onDeleteField(gi)}
              />
            ) : null,
          )}
        {size && draw && (
          <div
            className="pointer-events-none absolute rounded-sm"
            style={{
              left: Math.min(draw.x0, draw.x1) * size.w,
              top: Math.min(draw.y0, draw.y1) * size.h,
              width: Math.abs(draw.x1 - draw.x0) * size.w,
              height: Math.abs(draw.y1 - draw.y0) * size.h,
              border: `1.5px dashed ${previewColor}`,
              background: `${previewColor}18`,
            }}
          />
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
  onDelete,
}: {
  field: Field;
  pageSize: { w: number; h: number };
  color: string;
  label: string;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}) {
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: field.x, origY: field.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / pageSize.w;
    const dy = (e.clientY - drag.current.startY) / pageSize.h;
    const x = Math.min(Math.max(drag.current.origX + dx, 0), 1 - field.w);
    const y = Math.min(Math.max(drag.current.origY + dy, 0), 1 - field.h);
    onMove(x, y);
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  const h = field.h * pageSize.h;
  return (
    <div
      className="group absolute flex items-center justify-center overflow-hidden rounded-sm font-medium select-none"
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
      <span className="truncate px-1 leading-none">{FIELD_DEFAULTS[field.type].label}</span>
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
    </div>
  );
}

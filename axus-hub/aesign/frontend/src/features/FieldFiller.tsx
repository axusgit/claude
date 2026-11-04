import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Field } from "@/lib/api";
import { alertDialog } from "@/lib/confirm";
import { Button } from "@/components/ui";
import { SignaturePad } from "@/features/SignaturePad";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const TARGET_WIDTH = 800;
export const SCRIPT_FONT = '"Segoe Script","Brush Script MT","Snell Roundhand",cursive';

// Render a typed name as a script-font PNG (same data-URL shape as a drawn sig).
export function typedSignatureDataUrl(text: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 92;
  ctx.font = `italic ${size}px ${SCRIPT_FONT}`;
  while (size > 24 && ctx.measureText(text).width > 560) {
    size -= 4;
    ctx.font = `italic ${size}px ${SCRIPT_FONT}`;
  }
  ctx.fillText(text, 300, 108);
  return canvas.toDataURL("image/png");
}

// Apply a field value with the two shared rules: every date field for a signer
// mirrors the one signing date, and checkboxes in a group are mutually exclusive
// (checking one clears the rest, warning if it replaced an existing choice).
export function applyFieldValue(
  fields: Field[],
  prev: Record<string, string>,
  id: string,
  val: string,
): Record<string, string> {
  const next = { ...prev, [id]: val };
  const changed = fields.find((f) => f.id === id);
  if (changed?.type === "date") {
    for (const f of fields) if (f.type === "date" && f.id !== id) next[f.id!] = val;
  }
  if (changed?.type === "checkbox" && changed.grp && val === "true") {
    let hadOther = false;
    for (const f of fields) {
      if (f.type === "checkbox" && f.grp === changed.grp && f.id !== id) {
        if (prev[f.id!] === "true" || next[f.id!] === "true") hadOther = true;
        next[f.id!] = "";
      }
    }
    if (hadOther) {
      setTimeout(
        () =>
          alertDialog({
            title: "One choice only",
            message: "Only one Entity Type can be selected — your previous choice was cleared.",
          }),
        0,
      );
    }
  }
  return next;
}

// The interactive document filler: renders the PDF with each field as an input
// (signature/initials open a draw-or-type pad; date/name/title/text inline;
// checkbox toggles; select dropdown). Controlled via `values` + `setValue`.
// Shared by the public signer page and the in-app "Sign as Axus" flow.
export function FieldFiller({
  url,
  fields,
  values,
  setValue,
  recipientName,
}: {
  url: string;
  fields: Field[];
  values: Record<string, string>;
  setValue: (id: string, val: string) => void;
  recipientName: string;
}) {
  const [sigField, setSigField] = useState<Field | null>(null);
  const [sigData, setSigData] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");

  function openSignature(f: Field) {
    setSigField(f);
    setSigData(values[f.id!] ?? null);
    setSigMode("draw");
    setTypedName(f.type === "initials" ? "" : recipientName);
  }

  return (
    <>
      <FillerPdf url={url} fields={fields} values={values} setValue={setValue} openSignature={openSignature} />

      {sigField && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h3 className="mb-3 font-semibold">
              Add your {sigField.type === "initials" ? "initials" : "signature"}
            </h3>
            <div className="mb-3 inline-flex rounded-lg border border-line p-0.5 text-sm">
              {(["draw", "type"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSigMode(m)}
                  className={
                    "rounded-md px-3 py-1 font-medium capitalize transition-colors " +
                    (sigMode === m ? "bg-brand text-brand-fg" : "text-muted hover:text-ink")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
            {sigMode === "draw" ? (
              <SignaturePad onChange={setSigData} />
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={sigField.type === "initials" ? "Your initials" : "Type your full name"}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <div className="grid h-28 place-items-center rounded-lg border border-line bg-white">
                  <span style={{ fontFamily: SCRIPT_FONT, fontStyle: "italic", fontSize: 40, color: "#111827" }}>
                    {typedName || "Preview"}
                  </span>
                </div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSigField(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const value = sigMode === "type" ? typedSignatureDataUrl(typedName.trim()) : sigData;
                  if (value) setValue(sigField.id!, value);
                  setSigField(null);
                }}
                disabled={sigMode === "type" ? !typedName.trim() : !sigData}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FillerPdf({
  url,
  fields,
  values,
  setValue,
  openSignature,
}: {
  url: string;
  fields: Field[];
  values: Record<string, string>;
  setValue: (id: string, val: string) => void;
  openSignature: (f: Field) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument(url);
    task.promise.then((pdf) => {
      if (cancelled) return;
      setDoc(pdf);
      setNumPages(pdf.numPages);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  if (!doc) return <div className="p-8 text-center text-sm text-muted">Loading document…</div>;
  return (
    <div className="flex flex-col items-center gap-5">
      {Array.from({ length: numPages }, (_, i) => (
        <FillerPage
          key={i}
          doc={doc}
          pageNumber={i + 1}
          fields={fields}
          values={values}
          setValue={setValue}
          openSignature={openSignature}
        />
      ))}
    </div>
  );
}

function FillerPage({
  doc,
  pageNumber,
  fields,
  values,
  setValue,
  openSignature,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  fields: Field[];
  values: Record<string, string>;
  setValue: (id: string, val: string) => void;
  openSignature: (f: Field) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: pdfjsLib.RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setSize({ w: viewport.width, h: viewport.height });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [doc, pageNumber]);

  return (
    <div
      className="relative border border-line bg-surface shadow-sm"
      style={{ width: size?.w ?? TARGET_WIDTH, height: size?.h ?? TARGET_WIDTH * 1.29 }}
    >
      <canvas ref={canvasRef} className="block" />
      {size &&
        fields
          .filter((f) => f.page === pageNumber)
          .map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              pageSize={size}
              value={values[f.id!] ?? ""}
              setValue={(v) => setValue(f.id!, v)}
              openSignature={() => openSignature(f)}
            />
          ))}
    </div>
  );
}

function FieldInput({
  field,
  pageSize,
  value,
  setValue,
  openSignature,
}: {
  field: Field;
  pageSize: { w: number; h: number };
  value: string;
  setValue: (v: string) => void;
  openSignature: () => void;
}) {
  const style: React.CSSProperties = {
    left: field.x * pageSize.w,
    top: field.y * pageSize.h,
    width: field.w * pageSize.w,
    height: field.h * pageSize.h,
  };
  const fontSize = Math.max(9, Math.min(field.h * pageSize.h * 0.7, 14));
  const id = "f-" + field.id;
  const filled = value.length > 0;

  if (field.type === "signature" || field.type === "initials") {
    return (
      <button
        id={id}
        className={
          "absolute grid place-items-center overflow-hidden rounded-sm border-[1.5px] text-[11px] font-medium " +
          (filled
            ? "border-green-500 bg-green-50"
            : "border-yellow-500 bg-yellow-200/70 text-yellow-800 hover:bg-yellow-200")
        }
        style={style}
        onClick={openSignature}
      >
        {value ? (
          <img
            src={value}
            alt="signature"
            className="absolute inset-0 h-full w-full object-contain p-[1px]"
          />
        ) : (
          <span>{field.type === "initials" ? "Initials" : "Sign"}</span>
        )}
      </button>
    );
  }
  if (field.type === "checkbox") {
    const checked = value === "true" || value === "1";
    return (
      <button
        id={id}
        type="button"
        className={
          "absolute grid place-items-center rounded-sm border-[1.5px] font-bold text-gray-900 leading-none " +
          (checked ? "border-green-500 bg-green-50" : "border-yellow-500 bg-yellow-200/70 hover:bg-yellow-200")
        }
        style={{ ...style, fontSize }}
        onClick={() => setValue(checked ? "" : "true")}
        aria-pressed={checked}
      >
        {checked ? "✓" : ""}
      </button>
    );
  }
  if (field.type === "select") {
    return (
      <select
        id={id}
        className={
          "absolute rounded-sm border-[1.5px] px-1 leading-none outline-none text-gray-900 " +
          (filled ? "border-green-500 bg-green-50 focus:bg-white" : "border-yellow-500 bg-yellow-200/70 focus:bg-white")
        }
        style={{ ...style, fontSize }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      id={id}
      type="text"
      className={
        // Field values sit on the (always-light) document, so force dark ink +
        // a light focus background — never the theme's surface (dark in night mode).
        "absolute rounded-sm border-[1.5px] px-1 leading-none outline-none text-gray-900 placeholder:text-gray-500 " +
        (filled
          ? "border-green-500 bg-green-50 focus:bg-white"
          : "border-yellow-500 bg-yellow-200/70 focus:bg-white")
      }
      style={{ ...style, fontSize }}
      value={value}
      title={
        field.type === "date"
          ? field.page === 1
            ? "Effective Date — automatically set to your signature date. Changing any date updates all of them."
            : "Signing date — defaults to today; changing it also updates the Effective Date."
          : undefined
      }
      placeholder={
        field.type === "date"
          ? "Date"
          : field.type === "name"
            ? "Name"
            : field.type === "title"
              ? "Title"
              : "Text"
      }
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CheckCircle2, ScrollText } from "lucide-react";
import { signApi, type Field, type SignView } from "@/lib/api";
import { Button } from "@/components/ui";
import { SignaturePad } from "@/features/SignaturePad";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const TARGET_WIDTH = 800;

export function SignPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [sigField, setSigField] = useState<Field | null>(null);
  const [sigData, setSigData] = useState<string | null>(null);

  useEffect(() => {
    signApi.get(token).then(
      (v) => {
        const init: Record<string, string> = {};
        for (const f of v.fields) {
          if (f.value) init[f.id!] = f.value;
          else if (f.type === "name") init[f.id!] = v.recipient.name;
          else if (f.type === "date") init[f.id!] = new Date().toLocaleDateString();
        }
        setValues(init);
        setView(v);
        if (v.alreadySigned) setDone(true);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "Could not load"),
    );
  }, [token]);

  function setValue(id: string, val: string) {
    setValues((v) => ({ ...v, [id]: val }));
  }

  const required = view?.fields.filter((f) => f.required) ?? [];
  const allFilled = required.every((f) => (values[f.id!] ?? "").length > 0);
  const canSubmit = consent && allFilled && !submitting;

  async function submit() {
    if (!view) return;
    setSubmitting(true);
    setError(null);
    try {
      const fields = view.fields.map((f) => ({ id: f.id!, value: values[f.id!] ?? "" }));
      await signApi.complete(token, consent, fields);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !view) {
    return (
      <Centered>
        <ScrollText className="mx-auto h-9 w-9 text-muted" />
        <p className="mt-3 font-medium">{error}</p>
      </Centered>
    );
  }
  if (!view) return <Centered>Loading…</Centered>;

  if (done) {
    return (
      <Centered>
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <h1 className="mt-3 text-lg font-semibold">Thank you — you're all set</h1>
        <p className="mt-1 text-sm text-muted">
          Your signature on <span className="font-medium">{view.envelope.title}</span> has been
          recorded. Once all parties have signed, a completed copy will be emailed to everyone.
        </p>
      </Centered>
    );
  }

  const remaining = view.fields.filter((f) => f.required && !(values[f.id!] ?? "").length);
  function scrollToNext() {
    const next = remaining[0];
    if (!next) return;
    const el = document.getElementById("f-" + next.id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement | null)?.focus?.();
  }

  return (
    <div className="min-h-full pb-28">
      {remaining.length > 0 && (
        <button
          onClick={scrollToNext}
          className="fixed right-5 top-20 z-10 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-fg shadow-lg hover:bg-brand-hover"
        >
          Next field ({remaining.length})
        </button>
      )}
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
          <div className="text-[13px] font-bold tracking-wide">
            AXUS <span className="text-brand">eSIGN</span>
          </div>
          <div className="text-sm text-muted">
            Signing as <span className="font-medium text-ink">{view.recipient.name}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5">
        <div className="py-4">
          <h1 className="text-lg font-semibold">{view.envelope.title}</h1>
          <p className="text-sm text-muted">
            Complete the highlighted fields, then sign at the bottom.
          </p>
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <SignerPdf
          url={signApi.documentUrl(token)}
          fields={view.fields}
          values={values}
          setValue={setValue}
          openSignature={(f) => {
            setSigField(f);
            setSigData(values[f.id!] ?? null);
          }}
        />
      </div>

      {/* Sign bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I agree to sign electronically and that my electronic signature is legally binding
              (U.S. ESIGN Act / UETA).
            </span>
          </label>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? "Submitting…" : "Finish & Sign"}
          </Button>
        </div>
      </div>

      {/* Signature modal */}
      {sigField && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h3 className="mb-3 font-semibold">Add your {sigField.type === "initials" ? "initials" : "signature"}</h3>
            <SignaturePad onChange={setSigData} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSigField(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (sigData) setValue(sigField.id!, sigData);
                  setSigField(null);
                }}
                disabled={!sigData}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-white p-10 text-center">
        {children}
      </div>
    </div>
  );
}

// ---- Signer PDF viewer with interactive field inputs ----
function SignerPdf({
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
        <SignerPage
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

function SignerPage({
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
      className="relative border border-line bg-white shadow-sm"
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
  return (
    <input
      id={id}
      type="text"
      className={
        "absolute rounded-sm border-[1.5px] px-1 leading-none outline-none " +
        (filled
          ? "border-green-500 bg-green-50 focus:bg-white"
          : "border-yellow-500 bg-yellow-200/70 focus:bg-white")
      }
      style={{ ...style, fontSize }}
      value={value}
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

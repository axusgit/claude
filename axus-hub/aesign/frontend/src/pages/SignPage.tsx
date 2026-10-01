import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CheckCircle2, ScrollText } from "lucide-react";
import { signApi, type Field, type SignView } from "@/lib/api";
import { alertDialog } from "@/lib/confirm";
import { Button } from "@/components/ui";
import { SignaturePad } from "@/features/SignaturePad";
import axusLogo from "@/assets/axus-logo.png";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const TARGET_WIDTH = 800;
const SCRIPT_FONT = '"Segoe Script","Brush Script MT","Snell Roundhand",cursive';

// Render a typed name as a script-font PNG (same data-URL shape as a drawn sig).
function typedSignatureDataUrl(text: string): string {
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
  const [sigMode, setSigMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");
  const [declined, setDeclined] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const declineWords = declineReason.trim().split(/\s+/).filter(Boolean).length;

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
        if (v.recipient.status === "declined") setDeclined(true);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "Could not load"),
    );
  }, [token]);

  function setValue(id: string, val: string) {
    setValues((v) => {
      const next = { ...v, [id]: val };
      // Keep every date field for this signer in sync — the Effective Date mirrors
      // the signature date, since they all represent the one signing date.
      const changed = view?.fields.find((f) => f.id === id);
      if (changed?.type === "date") {
        for (const f of view?.fields ?? []) {
          if (f.type === "date" && f.id !== id) next[f.id!] = val;
        }
      }
      // One choice only: checking a box CLEARS every other box in its group, so at
      // most one is ever selected. Warn if this replaced an existing choice.
      if (changed?.type === "checkbox" && changed.grp && val === "true") {
        let hadOther = false;
        for (const f of view?.fields ?? []) {
          if (f.type === "checkbox" && f.grp === changed.grp && f.id !== id) {
            if (v[f.id!] === "true" || next[f.id!] === "true") hadOther = true;
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
    });
  }

  const allFields = view?.fields ?? [];
  const required = allFields.filter((f) => f.required);
  // Entity Type group: at least one box selected; if "Other" is checked, its text is required.
  const entityBoxes = allFields.filter((f) => f.type === "checkbox" && f.grp === "entity_type");
  const entityCount = entityBoxes.filter((f) => values[f.id!] === "true").length;
  const entityChosen = entityCount === 1;
  const otherCb = allFields.find((f) => f.type === "checkbox" && f.fkey === "entity_other");
  const otherTxt = allFields.find((f) => f.fkey === "entity_other_text");
  const otherNeedsText = !!(
    otherCb && values[otherCb.id!] === "true" && otherTxt && !(values[otherTxt.id!] ?? "").trim()
  );
  // Require EXACTLY one entity type (0 or >1 blocks signing), plus Other text if chosen.
  const entityBlocked = (entityBoxes.length > 0 && entityCount !== 1) || otherNeedsText;
  const allFilled =
    required.every((f) => (values[f.id!] ?? "").length > 0) && !entityBlocked;
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

  async function submitDecline() {
    if (declineWords < 10) return;
    setDeclining(true);
    setError(null);
    try {
      await signApi.decline(token, declineReason.trim());
      setShowDecline(false);
      setDeclined(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setDeclining(false);
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
        <img
          src={axusLogo}
          alt="Axus Technologies"
          width={130}
          className="mx-auto mb-6 h-auto w-[130px]"
        />
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <h1 className="mt-3 text-lg font-semibold">Thank you — you're all set</h1>
        <p className="mt-1 text-sm text-muted">
          Your signature on <span className="font-medium">{view.envelope.title}</span> has been
          recorded. Once all parties have signed, a completed copy will be emailed to everyone.
        </p>
      </Centered>
    );
  }

  if (declined) {
    return (
      <Centered>
        <img
          src={axusLogo}
          alt="Axus Technologies"
          width={130}
          className="mx-auto mb-6 h-auto w-[130px]"
        />
        <ScrollText className="mx-auto h-10 w-10 text-red-500" />
        <h1 className="mt-3 text-lg font-semibold">You declined to sign</h1>
        <p className="mt-1 text-sm text-muted">
          We've let the sender know you declined{" "}
          <span className="font-medium">{view.envelope.title}</span> and shared your reason. No
          signatures will be collected on this document.
        </p>
      </Centered>
    );
  }

  const remaining: { id: string }[] = view.fields
    .filter((f) => f.required && !(values[f.id!] ?? "").length)
    .map((f) => ({ id: f.id! }));
  if (entityBoxes.length > 0 && !entityChosen && entityBoxes[0]?.id) remaining.push({ id: entityBoxes[0].id });
  else if (otherNeedsText && otherTxt?.id) remaining.push({ id: otherTxt.id });
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
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <img src="/assets/axus-logo.png" alt="Axus Technologies" className="h-7 w-auto" />
            <span className="text-[13px] font-semibold text-muted">eSign</span>
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
            setSigMode("draw");
            setTypedName(f.type === "initials" ? "" : view.recipient.name);
          }}
        />
      </div>

      {/* Sign bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface">
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
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              onClick={() => setShowDecline(true)}
              disabled={submitting}
            >
              Decline
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Finish & Sign"}
            </Button>
          </div>
        </div>
      </div>

      {/* Decline modal */}
      {showDecline && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h3 className="font-semibold">Decline to sign</h3>
            <p className="mt-1 text-sm text-muted">
              Please explain why you're declining{" "}
              <span className="font-medium">{view.envelope.title}</span>. An explanation of at least
              10 words is required — the sender will see it.
            </p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={4}
              autoFocus
              className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="I'm declining because…"
            />
            <div className={"mt-1 text-xs " + (declineWords >= 10 ? "text-muted" : "text-red-600")}>
              {declineWords}/10 words minimum
            </div>
            {error && <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowDecline(false)} disabled={declining}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitDecline()}
                disabled={declineWords < 10 || declining}
              >
                {declining ? "Submitting…" : "Decline to sign"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Signature modal */}
      {sigField && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
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
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-10 text-center">
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

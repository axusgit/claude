import { useRef, useState } from "react";
import { ArrowLeft, Check, PenLine, X } from "lucide-react";
import { api, type Field, type FieldType, type Recipient } from "@/lib/api";
import { Button } from "@/components/ui";
import { PdfCanvas } from "@/features/PdfCanvas";
import { FieldFiller, applyFieldValue } from "@/features/FieldFiller";

// In-app "Sign as Axus" on ANY uploaded document (including one already
// completed, or a customer copy with no Axus block). Two steps, all in-app, all
// Axus, no second party:
//   1. Add whatever fields the document needs (full toolbar), placed on the page.
//   2. Fill every one of them (draw signature/initials, type name/title/text,
//      date, checkboxes) and seal.
// Reuses the proven PdfCanvas (placement) + FieldFiller (the real signer fill UI).
const AXUS_ID = "axus";
const AXUS_NAME = "Axus Technologies";
const AXUS_COLOR = "#ea580c"; // brand orange

// Field types the staff can drop (same as the editor, minus "select" which needs
// pre-defined options). Signature first — it's the one required to sign.
const TOOLS: { type: FieldType; label: string }[] = [
  { type: "signature", label: "Signature" },
  { type: "initials", label: "Initials" },
  { type: "date", label: "Date" },
  { type: "name", label: "Name" },
  { type: "title", label: "Title" },
  { type: "text", label: "Text" },
  { type: "checkbox", label: "Checkbox" },
];

export function AxusSignModal({
  envelopeId,
  onClose,
  onDone,
}: {
  envelopeId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [step, setStep] = useState<"place" | "fill">("place");
  const [fields, setFields] = useState<Field[]>([]);
  const [tool, setTool] = useState<FieldType | null>("signature");
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  // Synthetic recipient — only drives the placement box color/label; the real
  // Axus signer is created server-side, attributed to the logged-in staff.
  const axusRecipient: Recipient = {
    id: AXUS_ID,
    name: AXUS_NAME,
    email: "",
    role: "signer",
    sign_order: 1,
  };

  // Placement (step 1) — allow as many fields of any type as the form needs.
  function addField(f: Field) {
    setFields((prev) => [...prev, { ...f, id: `axf-${++seq.current}`, recipient_id: AXUS_ID }]);
  }
  function updateField(index: number, patch: Partial<Field>) {
    setFields((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function deleteField(index: number) {
    setFields((prev) => {
      const gone = prev[index];
      if (gone?.id) setValues((v) => { const n = { ...v }; delete n[gone.id!]; return n; });
      return prev.filter((_, i) => i !== index);
    });
  }

  const hasSignature = fields.some((f) => f.type === "signature");

  function goFill() {
    if (!hasSignature) {
      setErr("Add at least a Signature field before filling.");
      return;
    }
    setErr(null);
    // Prefill date fields with today (editable), like the signer page does.
    setValues((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (f.type === "date" && !next[f.id!]) next[f.id!] = new Date().toLocaleDateString();
      }
      return next;
    });
    setStep("fill");
  }

  function setValue(id: string, val: string) {
    setValues((v) => applyFieldValue(fields, v, id, val));
  }

  // Everything placed must be filled, except checkboxes (optional by nature);
  // at least one signature image must be present; consent required.
  const requiredFields = fields.filter((f) => f.type !== "checkbox");
  const allFilled = requiredFields.every((f) => (values[f.id!] ?? "").length > 0);
  const hasSignatureValue = fields.some(
    (f) => f.type === "signature" && (values[f.id!] ?? "").startsWith("data:image"),
  );
  const canSign = allFilled && hasSignatureValue && consent && !busy;

  async function submit() {
    if (!hasSignatureValue) return setErr("Draw your signature before signing.");
    if (!allFilled) return setErr("Fill every field before signing.");
    setBusy(true);
    setErr(null);
    try {
      await api.axusSelfSign(envelopeId, {
        consent: true,
        fields: fields.map((f) => ({
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          value: values[f.id!] ?? "",
        })),
      });
      onDone(
        "Signed as Axus — the document is sealed and marked Completed. The Axus team and you were emailed the finished copy.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not sign this document.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Document */}
        <div className="min-h-0 flex-1 overflow-auto bg-black/5 p-3 sm:p-4">
          {step === "place" ? (
            <PdfCanvas
              url={api.workingDocumentUrl(envelopeId)}
              fields={fields}
              recipients={[axusRecipient]}
              colorFor={() => AXUS_COLOR}
              labelFor={() => "Axus"}
              activeTool={tool}
              activeRecipientId={AXUS_ID}
              onAddField={addField}
              onUpdateField={updateField}
              onDeleteField={deleteField}
            />
          ) : (
            <FieldFiller
              url={api.workingDocumentUrl(envelopeId)}
              fields={fields}
              values={values}
              setValue={setValue}
              recipientName={AXUS_NAME}
            />
          )}
        </div>

        {/* Controls */}
        <div className="flex w-full shrink-0 flex-col gap-4 border-t border-line p-5 md:w-[340px] md:border-l md:border-t-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-semibold">
              <PenLine className="h-4 w-4 text-brand" /> Sign as Axus
            </div>
            <button onClick={onClose} className="text-muted hover:text-ink" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {step === "place" ? (
            <>
              <p className="text-sm text-muted">
                <span className="font-medium">Step 1 · Add fields.</span> Pick a field, then click on
                the document where it goes. Add as many as you need — all are Axus’s.
              </p>
              <div className="flex flex-wrap gap-2">
                {TOOLS.map((t) => (
                  <Button
                    key={t.type}
                    variant={tool === t.type ? "primary" : "outline"}
                    onClick={() => setTool(t.type)}
                    className="px-2.5 py-1.5 text-xs"
                  >
                    {t.label}
                    {fields.some((f) => f.type === t.type) ? " ✓" : ""}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {fields.length} field{fields.length === 1 ? "" : "s"} placed
                {hasSignature ? "" : " · add a Signature to continue"}. Drag to move, hover to resize
                or remove.
              </p>
              {err && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
              <div className="mt-auto flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={goFill} disabled={!hasSignature} className="flex-1">
                  Continue to fill
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                <span className="font-medium">Step 2 · Fill &amp; sign.</span> Complete every field —
                click a signature box to draw or type it — then sign. It’s sealed onto the document
                and marked <span className="font-medium">Completed</span>.
              </p>
              <label className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I agree to sign this document electronically on behalf of Axus Technologies (U.S.
                  ESIGN Act / UETA).
                </span>
              </label>
              {err && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
              <div className="mt-auto flex gap-2">
                <Button variant="outline" onClick={() => setStep("place")} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={() => void submit()} disabled={!canSign} className="flex-1">
                  <Check className="h-4 w-4" /> {busy ? "Signing…" : "Sign & complete"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

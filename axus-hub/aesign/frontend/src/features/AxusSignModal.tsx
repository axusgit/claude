import { useState } from "react";
import { Calendar, Check, PenLine, X } from "lucide-react";
import { api, type Field, type FieldType, type Recipient } from "@/lib/api";
import { Button } from "@/components/ui";
import { PdfCanvas } from "@/features/PdfCanvas";
import { SignaturePad } from "@/features/SignaturePad";

// In-app "Sign as Axus" on ANY document (including one already completed, or a
// customer copy with no Axus signature block). The staff member places their
// signature (+ optional date) directly on the page, draws it, and signs — the
// backend composites it onto the working PDF and re-seals. Reuses the proven
// PdfCanvas (placement) + SignaturePad (capture); never touches the other parties.
const AXUS_ID = "axus";
const AXUS_COLOR = "#ea580c"; // Axus brand orange

export function AxusSignModal({
  envelopeId,
  onClose,
  onDone,
}: {
  envelopeId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [fields, setFields] = useState<Field[]>([]);
  const [tool, setTool] = useState<FieldType | null>("signature");
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Synthetic recipient — only drives the placement box's color/label; the real
  // Axus signer is created server-side and attributed to the logged-in staff.
  const axusRecipient: Recipient = {
    id: AXUS_ID,
    name: "Axus Technologies",
    email: "",
    role: "signer",
    sign_order: 1,
  };

  const hasSig = fields.some((f) => f.type === "signature");
  const hasDate = fields.some((f) => f.type === "date");

  // Keep at most one signature and one date; placing a type again replaces it.
  function addField(f: Field) {
    setFields((prev) => [
      ...prev.filter((p) => p.type !== f.type),
      { ...f, id: `axus-${f.type}-${Date.now()}`, recipient_id: AXUS_ID },
    ]);
    setTool(null); // drop the tool so further canvas clicks don't re-place
  }
  function updateField(index: number, patch: Partial<Field>) {
    setFields((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function deleteField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  const canSign = hasSig && !!sig && consent && !busy;

  async function submit() {
    if (!hasSig) return setErr("Place your signature on the document first.");
    if (!sig) return setErr("Draw your signature below.");
    setBusy(true);
    setErr(null);
    try {
      await api.axusSelfSign(envelopeId, {
        consent: true,
        signature: sig,
        fields: fields.map((f) => ({ type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })),
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
        {/* Document with click-to-place */}
        <div className="min-h-0 flex-1 overflow-auto bg-black/5 p-3 sm:p-4">
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
          <p className="text-sm text-muted">
            Place your signature where it belongs on the document, draw it below, then sign. It’s
            sealed onto the document and marked <span className="font-medium">Completed</span>.
          </p>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">1 · Place on the page</div>
            <div className="flex gap-2">
              <Button
                variant={tool === "signature" ? "primary" : "outline"}
                onClick={() => setTool("signature")}
              >
                <PenLine className="h-4 w-4" /> Signature{hasSig ? " ✓" : ""}
              </Button>
              <Button
                variant={tool === "date" ? "primary" : "outline"}
                onClick={() => setTool("date")}
              >
                <Calendar className="h-4 w-4" /> Date{hasDate ? " ✓" : ""}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {tool === "signature"
                ? "Click the document where your signature goes."
                : tool === "date"
                  ? "Click where today’s date should print."
                  : hasSig
                    ? "Placed. Drag to adjust, or add a date."
                    : "Pick Signature, then click the document."}
            </p>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">2 · Draw your signature</div>
            <SignaturePad onChange={setSig} />
          </div>

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
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!canSign} className="flex-1">
              <Check className="h-4 w-4" /> {busy ? "Signing…" : "Sign & complete"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

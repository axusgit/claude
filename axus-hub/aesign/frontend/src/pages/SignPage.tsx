import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ScrollText } from "lucide-react";
import { signApi, type SignView } from "@/lib/api";
import { Button } from "@/components/ui";
import { FieldFiller, applyFieldValue } from "@/features/FieldFiller";
import axusLogo from "@/assets/axus-logo.png";

export function SignPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
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
    setValues((v) => applyFieldValue(view?.fields ?? [], v, id, val));
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
        <FieldFiller
          url={signApi.documentUrl(token)}
          fields={view.fields}
          values={values}
          setValue={setValue}
          recipientName={view.recipient.name}
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

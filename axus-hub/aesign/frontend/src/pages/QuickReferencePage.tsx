import { FileSignature, FileText, Receipt, ShieldCheck, Upload } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";

const STATUS_FLOW: { status: string; when: string }[] = [
  { status: "draft", when: "Created but not sent — still editable (recipients, fields, reminders)." },
  { status: "sent", when: "Emailed to all recipients for signature; locked from editing." },
  { status: "partially_completed", when: "At least one party has signed, but not everyone yet." },
  { status: "completed", when: "Everyone has signed — sealed PDF + certificate emailed to all." },
  { status: "declined", when: "A recipient declined to sign (with a reason) — no further signatures." },
  { status: "expired", when: "Auto-voided after 183 days unsigned — recipients can no longer sign." },
  { status: "cancelled", when: "Manually cancelled — recipients can no longer sign." },
];

type Flow = {
  icon: typeof FileText;
  name: string;
  tag: string;
  steps: string[];
};

const FLOWS: Flow[] = [
  {
    icon: Upload,
    name: "SOW · MSA · SOW & MSA",
    tag: "Upload-based",
    steps: [
      "New document → pick the Type and Company → Create & open (no title asked).",
      "Upload the PDF or Word file — the file name becomes the document title.",
      "Add up to 2 recipients; click the blank after each label (e.g. “Signature:”) to place fields.",
      "Save keeps it a draft; Send emails each recipient their signing link.",
    ],
  },
  {
    icon: ShieldCheck,
    name: "BAA",
    tag: "Template · deferred",
    steps: [
      "New document → BAA → pick the Company → Continue.",
      "The HIPAA BAA template opens PRE-FILLED: Effective Date = today, Covered Entity = the company, Governing Law = Florida.",
      "Nothing is saved until you click Save (or Send) — back out and no draft is left behind.",
      "Add the signer(s), place the signature fields on page 4, then Save or Send.",
    ],
  },
  {
    icon: Receipt,
    name: "Quote",
    tag: "Generated",
    steps: [
      "New document → Quote → pick the Company → Continue to the quote builder.",
      "Fill line items (Qty / Item # / Description / Unit Price / Discount); totals compute live.",
      "Generate builds a branded 2-page PDF (Quote # is auto: MMDDYYYY.NNN) and opens it as a document.",
      "Add the customer as a recipient, place the accept/sign fields, then Send.",
    ],
  },
];

export function QuickReferencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Quick reference</h1>
        <p className="text-sm text-muted">How each document type flows from creation to a signed, sealed copy.</p>
      </div>

      {/* Statuses */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-brand" /> Document statuses
        </div>
        <div className="space-y-2.5">
          {STATUS_FLOW.map((s) => (
            <div key={s.status} className="flex items-start gap-3">
              <div className="w-40 shrink-0">
                <StatusBadge status={s.status} />
              </div>
              <p className="text-sm text-muted">{s.when}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Per-type lifecycle */}
      <div className="grid gap-4 lg:grid-cols-3">
        {FLOWS.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.name} className="flex flex-col p-5">
              <div className="mb-1 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <div className="text-sm font-semibold">{f.name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">{f.tag}</div>
                </div>
              </div>
              <ol className="mt-3 space-y-2.5">
                {f.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-canvas text-[11px] font-semibold text-muted">
                      {i + 1}
                    </span>
                    <span className="text-ink/90">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          );
        })}
      </div>

      {/* Signing + completion */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FileSignature className="h-4 w-4 text-brand" /> Signing, reminders & completion
        </div>
        <ul className="grid gap-2.5 text-sm text-muted sm:grid-cols-2">
          <li>• Each recipient gets an email with a private signing link (no Axus account needed).</li>
          <li>• Optional order: require recipients to sign top-to-bottom.</li>
          <li>• After each signature, everyone is notified; anyone still pending gets a nudge.</li>
          <li>• Reminders (daily / weekly / monthly, Eastern time) — the first waits at least 24 hours.</li>
          <li>• When everyone signs, the document is <span className="font-medium text-ink">Completed</span>: a sealed PDF with a certificate of completion is emailed to all parties, and reminders stop.</li>
          <li>• Every action is recorded in the document's audit trail (who, when, IP).</li>
        </ul>
      </Card>

      <p className="text-xs text-muted">
        Type and Company are fixed once a document is created — change them anytime from the Documents list.
      </p>
    </div>
  );
}

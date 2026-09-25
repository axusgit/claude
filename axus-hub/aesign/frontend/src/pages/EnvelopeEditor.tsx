import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Briefcase,
  Calendar,
  Check,
  Download,
  History,
  Mail,
  MailCheck,
  PenLine,
  Pencil,
  Plus,
  Send,
  Trash2,
  Type,
  Upload,
  User,
  UserPlus,
  X,
} from "lucide-react";
import {
  api,
  contactsApi,
  type Contact,
  type EmailLogEntry,
  type EnvelopeDetail,
  type Field,
  type FieldType,
  type Recipient,
  type SignSlot,
} from "@/lib/api";
import { Button, Card, Input, StatusBadge } from "@/components/ui";
import { recipientColor } from "@/lib/utils";
import { PdfCanvas } from "@/features/PdfCanvas";

// BAA is generated on the fly (backend/src/baapdf.ts) on the Axus letterhead with
// two signers (Covered Entity, then Axus Technologies) at FIXED positions on a
// dedicated final page (page 5 — stable regardless of the baked company name).
// Add recipients IN THIS ORDER for auto-placement.
const BAA_LAYOUT: SignSlot[] = [
  {
    role: "Covered Entity",
    fields: [
      { type: "signature", page: 5, x: 0.1889, y: 0.3965, w: 0.2589, h: 0.0189 },
      { type: "name", page: 5, x: 0.2009, y: 0.4293, w: 0.2468, h: 0.0189 },
      { type: "title", page: 5, x: 0.1498, y: 0.4621, w: 0.2979, h: 0.0189 },
      { type: "date", page: 5, x: 0.1534, y: 0.4949, w: 0.2943, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 5, x: 0.5974, y: 0.3965, w: 0.2589, h: 0.0189 },
      { type: "name", page: 5, x: 0.6094, y: 0.4293, w: 0.2468, h: 0.0189 },
      { type: "title", page: 5, x: 0.5583, y: 0.4621, w: 0.2979, h: 0.0189 },
      { type: "date", page: 5, x: 0.5619, y: 0.4949, w: 0.2943, h: 0.0189 },
    ],
  },
];

// Certificate of Completion has two signers (Customer, then Axus Technologies)
// with FIXED signature-block positions on the final page — mirrors backend
// cocpdf.generateCocPdf(). Add recipients IN THIS ORDER for auto-placement.
const COC_LAYOUT: SignSlot[] = [
  {
    role: "Customer",
    fields: [
      { type: "signature", page: 1, x: 0.1758, y: 0.7323, w: 0.3013, h: 0.0189 },
      { type: "name", page: 1, x: 0.1878, y: 0.7601, w: 0.2893, h: 0.0189 },
      { type: "title", page: 1, x: 0.1367, y: 0.7879, w: 0.3404, h: 0.0189 },
      { type: "date", page: 1, x: 0.1404, y: 0.8157, w: 0.3368, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 1, x: 0.6072, y: 0.7323, w: 0.3013, h: 0.0189 },
      { type: "name", page: 1, x: 0.6192, y: 0.7601, w: 0.2893, h: 0.0189 },
      { type: "title", page: 1, x: 0.5681, y: 0.7879, w: 0.3404, h: 0.0189 },
      { type: "date", page: 1, x: 0.5717, y: 0.8157, w: 0.3368, h: 0.0189 },
    ],
  },
];

// SLA (After Hours On Call) has two signers (Client, then Axus Technologies) STACKED on a
// dedicated final page (page 4), each with Signature/Date on one row and Print Name/Title on
// the next — mirrors the Axus SOW block and backend slapdf.generateSlaPdf(). Coordinates match
// the generator's returned layout exactly. Add recipients IN THIS ORDER for auto-placement.
const SLA_LAYOUT: SignSlot[] = [
  {
    role: "Client",
    fields: [
      { type: "signature", page: 4, x: 0.1889, y: 0.3965, w: 0.3275, h: 0.0189 },
      { type: "date", page: 4, x: 0.5979, y: 0.3965, w: 0.2975, h: 0.0189 },
      { type: "name", page: 4, x: 0.2009, y: 0.4318, w: 0.3155, h: 0.0189 },
      { type: "title", page: 4, x: 0.5942, y: 0.4318, w: 0.3012, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 4, x: 0.1889, y: 0.5177, w: 0.3275, h: 0.0189 },
      { type: "date", page: 4, x: 0.5979, y: 0.5177, w: 0.2975, h: 0.0189 },
      { type: "name", page: 4, x: 0.2009, y: 0.553, w: 0.3155, h: 0.0189 },
      { type: "title", page: 4, x: 0.5942, y: 0.553, w: 0.3012, h: 0.0189 },
    ],
  },
];

const TOOLS: { type: FieldType; label: string; icon: typeof PenLine }[] = [
  { type: "signature", label: "Signature", icon: PenLine },
  { type: "name", label: "Name", icon: User },
  { type: "title", label: "Title", icon: Briefcase },
  { type: "initials", label: "Initials", icon: Type },
  { type: "date", label: "Date", icon: Calendar },
  { type: "text", label: "Text", icon: Type },
];

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  document_uploaded: "Document uploaded",
  sent: "Sent",
  viewed: "Viewed",
  reminded: "Reminder sent",
  consented: "Consented",
  signed: "Signed",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
  copy_sent: "Copy emailed",
};

// Audit trail — the full history of the signing process, for compliance/audit.
function HistoryCard({ events }: { events: EnvelopeDetail["events"] }) {
  if (!events.length) return null;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <History className="h-3.5 w-3.5" /> Audit trail
      </div>
      <ol className="space-y-2.5">
        {events.map((ev, i) => {
          const who = ev.actor && ev.actor !== "system" ? ev.actor : "";
          return (
            <li key={i} className="relative pl-4 text-xs">
              <span className="absolute left-0 top-1 h-1.5 w-1.5 rounded-full bg-brand" />
              <div className="font-medium">
                {EVENT_LABELS[ev.type] ?? ev.type}
                <span className="ml-1.5 font-normal text-muted">
                  {new Date(ev.at).toLocaleString()}
                </span>
              </div>
              {(who || ev.detail || ev.ip) && (
                <div className="break-words text-muted">
                  {who}
                  {ev.detail ? `${who ? " — " : ""}${ev.detail}` : ""}
                  {ev.ip ? ` · IP ${ev.ip}` : ""}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

const EMAIL_KIND_LABELS: Record<string, string> = {
  invite: "Signing invite",
  reminder: "Reminder",
  completed: "Completed copy",
  progress: "Progress update",
  declined: "Declined notice",
  copy: "PDF copy",
};

// Outbound email delivery log — shows, per attempt, whether the mail server
// accepted the message (with its SMTP response) or rejected it (with the error).
// "Accepted by mail server" is the strongest proof SMTP submission gives; it is
// not proof of inbox delivery (that needs a mailbox message trace).
function DeliveryCard({ log }: { log: EmailLogEntry[] }) {
  if (!log.length) return null;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <MailCheck className="h-3.5 w-3.5" /> Email delivery
      </div>
      <ol className="space-y-2.5">
        {log.map((m, i) => (
          <li key={i} className="relative pl-4 text-xs">
            <span
              className={
                "absolute left-0 top-1 h-1.5 w-1.5 rounded-full " +
                (m.success ? "bg-green-500" : "bg-red-500")
              }
            />
            <div className="font-medium">
              {EMAIL_KIND_LABELS[m.kind] ?? m.kind}
              <span className="ml-1.5 font-normal text-muted">{new Date(m.at).toLocaleString()}</span>
            </div>
            <div className="break-words text-muted">to {m.to_email}</div>
            {m.success ? (
              <div className="mt-0.5 flex min-w-0 items-start gap-1 text-green-600">
                <Check className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 break-words">
                  Accepted by mail server
                  {m.smtp_response ? (
                    <>
                      {" · "}
                      <span className="break-all">{m.smtp_response}</span>
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>
            ) : (
              <div className="mt-0.5 flex min-w-0 items-start gap-1 text-red-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 break-words">
                  Send failed
                  {m.error ? (
                    <>
                      {" · "}
                      <span className="break-all">{m.error}</span>
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-muted/80">
        "Accepted by mail server" confirms the message left Axus eSign and was taken by Office 365 — not
        that it reached the recipient's inbox. For inbox/spam/bounce status, run a message trace on the
        sending mailbox.
      </p>
    </Card>
  );
}

export function EnvelopeEditor() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // "new" mode = a deferred template-backed document (BAA): the template shows
  // pre-filled but NOTHING is persisted until the user clicks Save/Send.
  const isNew = id === "new";
  const [detail, setDetail] = useState<EnvelopeDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  // Copy-only recipients (role 'viewer'): receive the signed PDF on completion,
  // never sign. Kept separate from the (max 2) signer list above.
  const [ccRecipients, setCcRecipients] = useState<{ name: string; email: string }[]>([]);
  const [showCopy, setShowCopy] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(null);
  const [sequential, setSequential] = useState(false);
  const [docType, setDocType] = useState(isNew ? (sp.get("doc_type") ?? "BAA") : "SOW");
  const [company, setCompany] = useState(isNew ? (sp.get("company") ?? "") : "");
  // Certificate of Completion: staff-entered agreement # baked into the template.
  const [docNumber] = useState(isNew ? (sp.get("doc_number") ?? "") : "");
  const [reminder, setReminder] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderDow, setReminderDow] = useState(1);
  const [reminderDom, setReminderDom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signature blocks auto-detected in an uploaded PDF (SOW/MSA/etc.).
  const [detectedSlots, setDetectedSlots] = useState<SignSlot[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const signedRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (isNew) {
      const co = sp.get("company") ?? "";
      const dt = sp.get("doc_type") ?? "BAA";
      setDetail({
        envelope: {
          id: "new",
          title: co ? `${co} ${dt}` : `New ${dt}`,
          status: "draft",
          doc_type: dt,
          company: co,
          created_at: "",
        },
        recipients: [],
        fields: [],
        events: [],
        emailLog: [],
      });
      return;
    }
    const d = await api.getEnvelope(id);
    setDetail(d);
    setRecipients(d.recipients.filter((r) => r.role !== "viewer"));
    setCcRecipients(
      d.recipients.filter((r) => r.role === "viewer").map((r) => ({ name: r.name, email: r.email })),
    );
    setFields(d.fields);
    setSequential(!!d.envelope.sequential);
    setDocType(d.envelope.doc_type ?? "SOW");
    setCompany(d.envelope.company ?? "");
    setReminder(d.envelope.reminder_interval ?? "");
    setReminderTime(d.envelope.reminder_time ?? "09:00");
    setReminderDow(d.envelope.reminder_dow ?? 1);
    setReminderDom(d.envelope.reminder_dom ?? 1);
    setActiveRecipientId(
      (prev) => prev ?? d.recipients.find((r) => r.role !== "viewer")?.id ?? null,
    );
  }, [id, isNew, sp]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  // If a signature block is detected AFTER recipients were added (uploaded docs),
  // place fields for any recipient that doesn't have them yet.
  useEffect(() => {
    if (!detectedSlots.length) return;
    recipients.forEach((r, i) => {
      if (!r.id || fields.some((f) => f.recipient_id === r.id)) return;
      const slot = autoLayoutSlot(i);
      if (!slot?.length) return;
      setFields((fs) => [
        ...fs,
        ...slot.map((f) => ({
          recipient_id: r.id,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          required: true,
        })),
      ]);
      setDirty(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedSlots]);

  function colorFor(rid: string | null | undefined) {
    const idx = recipients.findIndex((r) => r.id === rid);
    return idx >= 0 ? recipientColor(idx) : "#9ca3af";
  }
  function labelFor(rid: string | null | undefined) {
    return recipients.find((r) => r.id === rid)?.name ?? "Unassigned";
  }

  // For Quote/BAA the signature-block positions are known, so we AUTO-PLACE this
  // signer's fields onto the matching block instead of making the sender click.
  function autoLayoutSlot(index: number): SignSlot["fields"] | undefined {
    // BAA = known template; Quote = layout stored on the envelope; uploads
    // (SOW/MSA/…) = signature blocks auto-detected from the PDF.
    const layout =
      docType === "BAA"
        ? BAA_LAYOUT
        : docType === "Certificate of Completion"
          ? COC_LAYOUT
          : docType === "SLA"
            ? SLA_LAYOUT
            : detail?.envelope.field_layout ?? detectedSlots;
    return layout?.[index]?.fields;
  }
  function addRecipient(name: string, email: string) {
    const index = recipients.length; // 0-based slot for this new signer
    const rec: Recipient = {
      id: crypto.randomUUID(),
      name,
      email,
      role: "signer",
      sign_order: index + 1,
    };
    setRecipients((r) => [...r, rec]);
    setActiveRecipientId(rec.id!);
    const slot = autoLayoutSlot(index);
    if (slot?.length) {
      const placed: Field[] = slot.map((f) => ({
        recipient_id: rec.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        required: true,
      }));
      setFields((fs) => [...fs, ...placed]);
    }
    setDirty(true);
  }
  function updateRecipient(rid: string, patch: Partial<Recipient>) {
    setRecipients((rs) => rs.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function removeRecipient(rid: string) {
    const remaining = recipients.filter((r) => r.id !== rid);
    setRecipients(remaining);
    setFields((fs) => fs.filter((f) => f.recipient_id !== rid)); // drop their fields too
    if (activeRecipientId === rid) setActiveRecipientId(remaining[0]?.id ?? null);
    setDirty(true);
  }

  function addField(f: Field) {
    setFields((fs) => [...fs, f]);
    setDirty(true);
  }
  function updateField(index: number, patch: Partial<Field>) {
    setFields((fs) => fs.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    setDirty(true);
  }
  function deleteField(index: number) {
    setFields((fs) => fs.filter((_, i) => i !== index));
    setDirty(true);
  }

  const [uploading, setUploading] = useState(false);
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await api.uploadDocument(id, file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Persist recipients/fields/settings. In "new" mode this first CREATES the
  // envelope + applies the (pre-filled) template, then saves everything onto it.
  // Returns the real envelope id. Does not navigate.
  async function persist(): Promise<string> {
    let realId = id;
    if (isNew) {
      const title = company ? `${company} ${docType}` : `New ${docType}`;
      const env = await api.createEnvelope({ title, doc_type: docType, company, doc_number: docNumber });
      realId = env.id;
      await api.applyTemplate(realId); // bakes date + company (+ doc #) into the template
    }
    const saved = await api.saveRecipients(realId, recipients);
    setRecipients(saved);
    await api.saveCc(realId, ccRecipients);
    await api.saveFields(realId, fields);
    await api.updateEnvelope(realId, {
      sequential,
      doc_type: docType,
      company,
      reminder_interval: reminder,
      reminder_time: reminderTime,
      reminder_dow: reminderDow,
      reminder_dom: reminderDom,
    });
    setDirty(false);
    return realId;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const realId = await persist();
      if (isNew) nav(`/envelopes/${realId}`); // switch to the real (saved) document
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const [sending, setSending] = useState(false);
  async function send() {
    if (
      !window.confirm(
        "Send this document to all recipients for signature? Each will receive an email with their signing link.",
      )
    )
      return;
    setSending(true);
    setError(null);
    try {
      const realId = isNew || dirty ? await persist() : id;
      await api.sendEnvelope(realId);
      nav("/"); // back to the Documents list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setSending(false);
    }
  }
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function remind(rid: string) {
    setRemindingId(rid);
    setError(null);
    setNotice(null);
    try {
      const res = await api.remindRecipient(id, rid);
      setNotice(res.sent ? "Reminder emailed." : "Reminder could not be emailed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reminder failed");
    } finally {
      setRemindingId(null);
    }
  }
  // Upload a copy signed OFFLINE (wet ink). Staff pick WHICH signer(s) actually
  // signed on the paper copy; anyone left keeps their fields and signs the
  // uploaded copy electronically — the document only completes once all have
  // signed. (On Call quotes flow back to On Call's Invoices on completion.)
  const [uploadingSigned, setUploadingSigned] = useState(false);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [signedSel, setSignedSel] = useState<Set<string>>(new Set());
  // Signers who could have signed on the paper copy: exclude copy-only viewers,
  // decliners, and anyone who already signed.
  const signableRecipients = recipients.filter(
    (r) => r.id && r.role !== "viewer" && r.status !== "declined" && r.status !== "signed",
  );
  function onUploadSigned(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    // Default: assume everyone still outstanding signed on the copy; staff
    // uncheck anyone who will instead sign electronically.
    setSignedSel(new Set(signableRecipients.map((r) => r.id as string)));
    setSignedFile(file);
  }
  async function submitSignedCopy() {
    if (!signedFile) return;
    setError(null);
    setNotice(null);
    setUploadingSigned(true);
    try {
      const res = await api.uploadSignedCopy(id, signedFile, Array.from(signedSel));
      setSignedFile(null);
      await load();
      if (res.completed) {
        setNotice("Signed copy uploaded — document marked Completed.");
      } else {
        const names = (res.awaiting ?? []).map((a) => a.name).join(", ");
        setNotice(
          `Signed copy uploaded. ${names || "The remaining signer(s)"} still need to sign — they've been emailed a link to sign electronically on this copy.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingSigned(false);
    }
  }
  async function cancelDoc() {
    if (!window.confirm("Cancel this document? Recipients will no longer be able to sign it.")) return;
    try {
      await api.cancelEnvelope(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }
  function saveReminder(patch: {
    reminder_interval?: string;
    reminder_time?: string;
    reminder_dow?: number;
    reminder_dom?: number;
  }) {
    if (patch.reminder_interval !== undefined) setReminder(patch.reminder_interval);
    if (patch.reminder_time !== undefined) setReminderTime(patch.reminder_time);
    if (patch.reminder_dow !== undefined) setReminderDow(patch.reminder_dow);
    if (patch.reminder_dom !== undefined) setReminderDom(patch.reminder_dom);
    if (!isNew) void api.updateEnvelope(id, patch); // new mode persists on Save
  }

  if (!detail) {
    return <div className="p-8 text-center text-sm text-muted">{error ?? "Loading…"}</div>;
  }

  const hasPdf = isNew || !!detail.envelope.pdf_file;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted hover:text-ink">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold">{detail.envelope.title}</h1>
            <div className="mt-0.5 flex items-center gap-2">
              <StatusBadge status={detail.envelope.status} />
              {docType && (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                  {docType}
                </span>
              )}
              {company && <span className="text-xs text-muted">{company}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
          <ReminderControl
            interval={reminder}
            time={reminderTime}
            dow={reminderDow}
            dom={reminderDom}
            onSave={saveReminder}
          />
          {detail.envelope.pdf_file && (
            <a href={api.documentUrl(id)} target="_blank" rel="noopener" title="Download document">
              <Button variant="ghost">
                <Download className="h-4 w-4" />
              </Button>
            </a>
          )}
          {!isNew && !!detail.envelope.pdf_file && (
            <Button
              variant="outline"
              onClick={() => setShowCopy(true)}
              title="Email a PDF copy to people who don't need to sign"
            >
              <Mail className="h-4 w-4" /> Send a copy
            </Button>
          )}
          {(detail.envelope.status === "draft" ||
            detail.envelope.status === "sent" ||
            detail.envelope.status === "partially_completed") &&
            !!detail.envelope.pdf_file && (
              <>
                <input
                  ref={signedRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={onUploadSigned}
                />
                <Button
                  variant="outline"
                  onClick={() => signedRef.current?.click()}
                  disabled={uploadingSigned}
                  title="Completed offline? Upload the manually signed copy to mark this document Completed."
                >
                  <Check className="h-4 w-4" />
                  {uploadingSigned ? "Uploading…" : "Upload signed copy"}
                </Button>
              </>
            )}
          {(detail.envelope.status === "sent" ||
            detail.envelope.status === "partially_completed") && (
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              onClick={() => void cancelDoc()}
            >
              Cancel
            </Button>
          )}
          {detail.envelope.status === "draft" && (
            <Button
              variant="outline"
              onClick={() => void save()}
              disabled={saving || (!isNew && !dirty)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          <Button
            onClick={() => void send()}
            disabled={sending || detail.envelope.status !== "draft" || fields.length === 0}
            title={fields.length === 0 ? "Add at least one field before sending" : undefined}
          >
            <Send className="h-4 w-4" />
            {detail.envelope.status !== "draft" ? "Sent" : sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div>
      )}

      {detail.envelope.status === "declined" &&
        (() => {
          const d = recipients.find((r) => r.status === "declined");
          return (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <span className="font-semibold">Declined{d ? ` by ${d.name}` : ""}.</span>{" "}
              {d?.decline_reason || "No reason provided."}
            </div>
          );
        })()}

      {!hasPdf ? (
        <Card className="p-10 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 font-medium">Upload the document</p>
          <p className="mb-4 text-sm text-muted">
            Upload a <span className="font-medium">PDF</span> or{" "}
            <span className="font-medium">Word (.doc / .docx)</span> — Word files are converted to PDF
            automatically.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={onUpload}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Choose file"}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          {/* Sidebar */}
          <div className="space-y-4">
            <RecipientsPanel
              recipients={recipients}
              activeId={activeRecipientId}
              onSelect={setActiveRecipientId}
              onAdd={addRecipient}
              onUpdate={updateRecipient}
              onRemove={removeRecipient}
              sequential={sequential}
              onToggleSequential={(v) => {
                setSequential(v);
                setDirty(true);
              }}
              envelopeStatus={detail.envelope.status}
              onRemind={remind}
              remindingId={remindingId}
            />
            <CcPanel
              recipients={ccRecipients}
              editable={detail.envelope.status === "draft"}
              onChange={(list) => {
                setCcRecipients(list);
                setDirty(true);
              }}
            />
            {detail.envelope.status === "draft" ? (
              <Card className="p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Fields
                </div>
                {recipients.length === 0 ? (
                  <p className="text-xs text-muted">
                    Add a recipient first, then place fields for them.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {TOOLS.map((t) => {
                      const Icon = t.icon;
                      const active = activeTool === t.type;
                      return (
                        <button
                          key={t.type}
                          onClick={() => setActiveTool(active ? null : t.type)}
                          className={
                            "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium transition-colors " +
                            (active ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-canvas")
                          }
                        >
                          <Icon className="h-4 w-4" />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {activeTool && (
                  <p className="mt-2 text-[11px] text-muted">
                    Click on the blank after a label (e.g. “Signature:”) to place a{" "}
                    <span className="font-medium">{activeTool}</span> field for{" "}
                    <span className="font-medium">{labelFor(activeRecipientId)}</span>.
                  </p>
                )}
              </Card>
            ) : (
              <Card className="p-3 text-xs text-muted">
                This document has been sent — it can no longer be edited.
              </Card>
            )}
            <DeliveryCard log={detail.emailLog ?? []} />
            <HistoryCard events={detail.events} />
          </div>

          {/* Document */}
          <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-canvas p-4">
            <PdfCanvas
              url={isNew ? api.templatePreviewUrl(docType, company, docNumber) : api.documentUrl(id)}
              // A completed document's sealed PDF already carries every signature/
              // value — showing field boxes on top would just clutter it. Before
              // then, boxes are shown but locked once the document leaves draft.
              fields={detail.envelope.status === "completed" ? [] : fields}
              readOnly={detail.envelope.status !== "draft"}
              recipients={recipients}
              colorFor={colorFor}
              labelFor={labelFor}
              activeTool={activeTool}
              activeRecipientId={activeRecipientId}
              onAddField={addField}
              onUpdateField={updateField}
              onDeleteField={deleteField}
              onDetectLayout={setDetectedSlots}
            />
          </div>
        </div>
      )}

      {showCopy && (
        <SendCopyDialog
          envelopeId={id}
          onClose={() => setShowCopy(false)}
          onDone={(msg) => {
            setNotice(msg);
            setShowCopy(false);
            void load();
          }}
        />
      )}

      {signedFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !uploadingSigned && setSignedFile(null)}
        >
          <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2 text-base font-semibold">
              <Check className="h-4 w-4 text-brand" /> Upload signed copy
            </div>
            <p className="mb-3 text-sm text-muted">
              Who signed on <span className="font-medium">{signedFile.name}</span>? The people you
              check are recorded as having signed on paper and their fields are removed. Anyone left
              unchecked keeps their fields and is emailed a link to sign this copy electronically.
            </p>
            {signableRecipients.length === 0 ? (
              <p className="rounded-lg bg-canvas p-3 text-sm text-muted">
                Everyone has already signed — this copy will be recorded as the final signed
                document.
              </p>
            ) : (
              <div className="space-y-1.5">
                {signableRecipients.map((r) => {
                  const checked = signedSel.has(r.id as string);
                  return (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line p-2.5 text-sm hover:bg-canvas"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSignedSel((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id as string)) next.delete(r.id as string);
                            else next.add(r.id as string);
                            return next;
                          })
                        }
                      />
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: colorFor(r.id) }}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{r.name}</span>{" "}
                        <span className="text-muted">· {r.email}</span>
                        <span className="ml-1 text-xs text-muted">
                          {checked ? "signed on paper" : "will sign electronically"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSignedFile(null)}
                disabled={uploadingSigned}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitSignedCopy()}
                disabled={uploadingSigned || (signableRecipients.length > 0 && signedSel.size === 0)}
              >
                {uploadingSigned ? "Uploading…" : "Upload signed copy"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// Modal: email a plain PDF copy to one or more non-signers, with an optional note.
function SendCopyDialog({
  envelopeId,
  onClose,
  onDone,
}: {
  envelopeId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    contactsApi.list().then(setContacts).catch(() => {});
  }, []);
  // Add a saved contact's email to the list (deduped), so several can be picked.
  function addContact(cid: string) {
    const c = contacts.find((x) => x.id === cid);
    if (!c) return;
    setEmails((prev) => {
      const list = prev.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      if (list.some((x) => x.toLowerCase() === c.email.toLowerCase())) return prev;
      return [...list, c.email].join(", ");
    });
  }
  async function submit() {
    const list = emails
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) {
      setErr("Enter at least one email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.sendCopy(envelopeId, list, note.trim() || undefined);
      if (res.sent > 0) {
        onDone(
          `Copy emailed to ${res.sent} recipient${res.sent === 1 ? "" : "s"}` +
            (res.failed.length ? ` · ${res.failed.length} failed` : "") +
            ".",
        );
      } else {
        setErr(
          res.failed.length
            ? `Could not send to: ${res.failed.join(", ")}`
            : "Could not send the copy.",
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Mail className="h-4 w-4 text-brand" /> Send a copy
        </div>
        <p className="mb-3 text-sm text-muted">
          Email a PDF copy to people who don’t need to sign — they just get the document.
        </p>
        <label className="mb-1 block text-xs font-medium text-muted">Email addresses</label>
        {contacts.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              addContact(e.target.value);
              e.target.value = "";
            }}
            className="mb-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">Choose from contacts…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.email}
              </option>
            ))}
          </select>
        )}
        <Input
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="jane@acme.com, bob@acme.com"
          autoFocus
        />
        <p className="mt-1 text-[11px] text-muted">
          Pick from contacts above, or type addresses separated by commas.
        </p>
        <label className="mb-1 mt-3 block text-xs font-medium text-muted">Note (optional)</label>
        <textarea
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a short message…"
        />
        {err && <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            <Mail className="h-4 w-4" /> {busy ? "Sending…" : "Send copy"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Sidebar panel: copy-only recipients (role 'viewer') who receive the signed PDF
// on completion but never sign. Editable while the document is a draft.
function CcPanel({
  recipients,
  editable,
  onChange,
}: {
  recipients: { name: string; email: string }[];
  editable: boolean;
  onChange: (list: { name: string; email: string }[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    contactsApi.list().then(setContacts).catch(() => {});
  }, []);
  function pickContact(cid: string) {
    const c = contacts.find((x) => x.id === cid);
    if (c) {
      setName(c.name);
      setEmail(c.email);
    }
  }
  function add() {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return;
    onChange([...recipients, { name: name.trim() || e, email: e }]);
    setName("");
    setEmail("");
    setAdding(false);
  }
  function remove(i: number) {
    onChange(recipients.filter((_, idx) => idx !== i));
  }
  if (!editable && recipients.length === 0) return null;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Copy recipients <span className="normal-case text-muted/70">(no signature)</span>
        </div>
        {editable && (
          <button
            className="text-muted hover:text-brand"
            onClick={() => setAdding((v) => !v)}
            title="Add a copy recipient"
          >
            <UserPlus className="h-4 w-4" />
          </button>
        )}
      </div>
      {recipients.length === 0 && !adding ? (
        <p className="text-xs text-muted">
          Add people who should receive the signed PDF but don’t sign.
        </p>
      ) : (
        <div className="space-y-1.5">
          {recipients.map((r, i) => (
            <div
              key={`${r.email}-${i}`}
              className="group flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-sm"
            >
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">{r.email}</span>
              </span>
              {editable && (
                <button
                  onClick={() => remove(i)}
                  className="shrink-0 text-muted opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && editable && (
        <div className="mt-2 space-y-2 rounded-lg border border-brand/40 p-2">
          {contacts.length > 0 && (
            <select
              value=""
              onChange={(e) => pickContact(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">Choose from contacts…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.email}
                </option>
              ))}
            </select>
          )}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name (optional)"
          />
          <Input
            value={email}
            type="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@company.com"
          />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={add} disabled={!email.trim()}>
              <Check className="h-3.5 w-3.5" /> Add
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReminderControl({
  interval,
  time,
  dow,
  dom,
  onSave,
}: {
  interval: string;
  time: string;
  dow: number;
  dom: number;
  onSave: (patch: {
    reminder_interval?: string;
    reminder_time?: string;
    reminder_dow?: number;
    reminder_dom?: number;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const inputCls =
    "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm hover:bg-canvas"
        title="Automatic reminders to recipients who haven't signed"
      >
        <Bell className="h-3.5 w-3.5 text-muted" />
        <span className={interval ? "text-ink" : "text-muted"}>
          {interval ? `Reminder: ${interval[0].toUpperCase()}${interval.slice(1)}` : "No reminders"}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-lg">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted">Remind unsigned recipients</label>
              <select
                value={interval}
                onChange={(e) => onSave({ reminder_interval: e.target.value })}
                className={inputCls}
              >
                <option value="">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {interval === "weekly" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted">Day of week</label>
                <select
                  value={dow}
                  onChange={(e) => onSave({ reminder_dow: Number(e.target.value) })}
                  className={inputCls}
                >
                  {DOW.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {interval === "monthly" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted">Day of month</label>
                <select
                  value={dom}
                  onChange={(e) => onSave({ reminder_dom: Number(e.target.value) })}
                  className={inputCls}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {interval && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted">Time (Eastern)</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => onSave({ reminder_time: e.target.value })}
                  className={inputCls}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RecipientsPanel({
  recipients,
  activeId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  sequential,
  onToggleSequential,
  envelopeStatus,
  onRemind,
  remindingId,
}: {
  recipients: Recipient[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, email: string) => void;
  onUpdate: (id: string, patch: Partial<Recipient>) => void;
  onRemove: (id: string) => void;
  sequential: boolean;
  onToggleSequential: (v: boolean) => void;
  envelopeStatus: string;
  onRemind: (id: string) => void;
  remindingId: string | null;
}) {
  // A document that's out for signature can have individual recipients nudged.
  const outForSignature =
    envelopeStatus === "sent" || envelopeStatus === "partially_completed";
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  function startEdit(r: Recipient) {
    setEditingId(r.id!);
    setEditName(r.name);
    setEditEmail(r.email);
    setAdding(false);
  }
  function saveEdit(r: Recipient) {
    if (!editName.trim() || !editEmail.trim()) return;
    onUpdate(r.id!, { name: editName.trim(), email: editEmail.trim() });
    setEditingId(null);
  }
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saveContact, setSaveContact] = useState(false);

  useEffect(() => {
    contactsApi.list().then(setContacts).catch(() => {});
  }, []);

  function pickContact(cid: string) {
    const c = contacts.find((x) => x.id === cid);
    if (c) {
      setName(c.name);
      setEmail(c.email);
    }
  }

  async function submit() {
    if (!name.trim() || !email.trim()) return;
    if (saveContact) {
      try {
        const c = await contactsApi.add({ name: name.trim(), email: email.trim() });
        setContacts((prev) =>
          [...prev.filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        /* non-fatal */
      }
    }
    onAdd(name.trim(), email.trim());
    setName("");
    setEmail("");
    setSaveContact(false);
    setAdding(false);
  }

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Recipients <span className="normal-case text-muted/70">({recipients.length}/2)</span>
        </div>
        {recipients.length < 2 && (
          <button className="text-muted hover:text-brand" onClick={() => setAdding((v) => !v)}>
            <UserPlus className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {recipients.map((r, i) =>
          editingId === r.id ? (
            <div key={r.id} className="space-y-2 rounded-lg border border-brand/40 p-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Full name"
              />
              <Input
                value={editEmail}
                type="email"
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="email@company.com"
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => saveEdit(r)}
                  disabled={!editName.trim() || !editEmail.trim()}
                >
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={r.id}
              className={
                "group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors " +
                (activeId === r.id ? "border-brand bg-brand/5" : "border-line hover:bg-canvas")
              }
            >
              <button
                onClick={() => onSelect(r.id!)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: recipientColor(i) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted">{r.email}</span>
                  {r.last_send_ok === false ? (
                    <span
                      className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-red-600"
                      title={r.last_send_error ?? "The last email to this recipient failed to send."}
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" /> Email failed to send
                    </span>
                  ) : r.last_send_ok === true ? (
                    <span
                      className="mt-0.5 flex items-center gap-1 text-[11px] text-green-600"
                      title={
                        (r.last_send_response ?? "Accepted by the mail server") +
                        (r.last_send_at ? ` · ${new Date(r.last_send_at).toLocaleString()}` : "")
                      }
                    >
                      <MailCheck className="h-3 w-3 shrink-0" /> Sent · accepted by mail server
                    </span>
                  ) : null}
                </span>
              </button>
              {outForSignature &&
                (r.status === "signed" ? (
                  <span
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-600"
                    title="Completed"
                  >
                    <Check className="h-3.5 w-3.5" /> Signed
                  </span>
                ) : r.status === "pending" ? (
                  <span className="shrink-0 text-xs text-muted" title="Waiting for their turn to sign">
                    Waiting
                  </span>
                ) : (
                  <button
                    onClick={() => onRemind(r.id!)}
                    disabled={remindingId === r.id}
                    title="Email this recipient a reminder to complete their part"
                    className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand disabled:opacity-50"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    {remindingId === r.id ? "Sending…" : "Remind"}
                  </button>
                ))}
              <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => startEdit(r)}
                  className="text-muted hover:text-brand"
                  title="Edit recipient"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Remove ${r.name}?`)) onRemove(r.id!);
                  }}
                  className="text-muted hover:text-red-600"
                  title="Remove recipient"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ),
        )}
        {recipients.length === 0 && !adding && (
          <p className="py-1 text-xs text-muted">No recipients yet.</p>
        )}
      </div>
      {recipients.length < 2 &&
        (adding ? (
        <div className="mt-2 space-y-2">
          {contacts.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => pickContact(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">Choose from contacts…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.email}
                </option>
              ))}
            </select>
          )}
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="email@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={saveContact}
              onChange={(e) => setSaveContact(e.target.checked)}
            />
            Save to contacts
          </label>
          <Button className="w-full" onClick={() => void submit()} disabled={!name.trim() || !email.trim()}>
            Add recipient
          </Button>
        </div>
      ) : (
        <button
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line py-1.5 text-xs text-muted hover:bg-canvas"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Add recipient
        </button>
      ))}
      {recipients.length >= 2 && (
        <label className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-xs text-muted">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(e) => onToggleSequential(e.target.checked)}
            className="mt-0.5"
          />
          <span>Recipients must sign in order (top to bottom)</span>
        </label>
      )}
    </Card>
  );
}

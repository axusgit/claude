import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Calendar,
  Check,
  Download,
  History,
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
  type EnvelopeDetail,
  type Field,
  type FieldType,
  type Recipient,
} from "@/lib/api";
import { Button, Card, Input, StatusBadge } from "@/components/ui";
import { recipientColor } from "@/lib/utils";
import { PdfCanvas } from "@/features/PdfCanvas";

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
  consented: "Consented",
  signed: "Signed",
  completed: "Completed",
  voided: "Voided",
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

export function EnvelopeEditor() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // "new" mode = a deferred template-backed document (BAA): the template shows
  // pre-filled but NOTHING is persisted until the user clicks Save/Send.
  const isNew = id === "new";
  const [detail, setDetail] = useState<EnvelopeDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(null);
  const [sequential, setSequential] = useState(false);
  const [docType, setDocType] = useState(isNew ? (sp.get("doc_type") ?? "BAA") : "SOW");
  const [company, setCompany] = useState(isNew ? (sp.get("company") ?? "") : "");
  const [reminder, setReminder] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderDow, setReminderDow] = useState(1);
  const [reminderDom, setReminderDom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      });
      return;
    }
    const d = await api.getEnvelope(id);
    setDetail(d);
    setRecipients(d.recipients);
    setFields(d.fields);
    setSequential(!!d.envelope.sequential);
    setDocType(d.envelope.doc_type ?? "SOW");
    setCompany(d.envelope.company ?? "");
    setReminder(d.envelope.reminder_interval ?? "");
    setReminderTime(d.envelope.reminder_time ?? "09:00");
    setReminderDow(d.envelope.reminder_dow ?? 1);
    setReminderDom(d.envelope.reminder_dom ?? 1);
    setActiveRecipientId((prev) => prev ?? d.recipients[0]?.id ?? null);
  }, [id, isNew, sp]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  function colorFor(rid: string | null | undefined) {
    const idx = recipients.findIndex((r) => r.id === rid);
    return idx >= 0 ? recipientColor(idx) : "#9ca3af";
  }
  function labelFor(rid: string | null | undefined) {
    return recipients.find((r) => r.id === rid)?.name ?? "Unassigned";
  }

  function addRecipient(name: string, email: string) {
    const rec: Recipient = {
      id: crypto.randomUUID(),
      name,
      email,
      role: "signer",
      sign_order: recipients.length + 1,
    };
    setRecipients((r) => [...r, rec]);
    setActiveRecipientId(rec.id!);
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
      const env = await api.createEnvelope({ title, doc_type: docType, company });
      realId = env.id;
      await api.applyTemplate(realId); // bakes today's date + company into the BAA
    }
    const saved = await api.saveRecipients(realId, recipients);
    setRecipients(saved);
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

      {!hasPdf ? (
        <Card className="p-10 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 font-medium">Upload the document</p>
          <p className="mb-4 text-sm text-muted">
            Upload a <span className="font-medium">PDF</span> or{" "}
            <span className="font-medium">Word (.docx)</span> document — Word files are converted to
            PDF automatically.
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
            <HistoryCard events={detail.events} />
          </div>

          {/* Document */}
          <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-canvas p-4">
            <PdfCanvas
              url={isNew ? api.templatePreviewUrl(docType, company) : api.documentUrl(id)}
              fields={fields}
              recipients={recipients}
              colorFor={colorFor}
              labelFor={labelFor}
              activeTool={activeTool}
              activeRecipientId={activeRecipientId}
              onAddField={addField}
              onUpdateField={updateField}
              onDeleteField={deleteField}
            />
          </div>
        </div>
      )}
    </div>
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
    "w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-brand";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm hover:bg-canvas"
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
          <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-[var(--radius-card)] border border-line bg-white p-3 shadow-lg">
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
}: {
  recipients: Recipient[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, email: string) => void;
  onUpdate: (id: string, patch: Partial<Recipient>) => void;
  onRemove: (id: string) => void;
  sequential: boolean;
  onToggleSequential: (v: boolean) => void;
}) {
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
                </span>
              </button>
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
              className="w-full rounded-lg border border-line bg-white px-2 py-2 text-sm outline-none focus:border-brand"
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

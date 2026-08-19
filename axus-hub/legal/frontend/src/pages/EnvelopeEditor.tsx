import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CheckSquare,
  PenLine,
  Plus,
  Send,
  Type,
  Upload,
  User,
  UserPlus,
} from "lucide-react";
import { api, type EnvelopeDetail, type Field, type FieldType, type Recipient } from "@/lib/api";
import { Button, Card, Input, StatusBadge } from "@/components/ui";
import { recipientColor } from "@/lib/utils";
import { PdfCanvas } from "@/features/PdfCanvas";

const TOOLS: { type: FieldType; label: string; icon: typeof PenLine }[] = [
  { type: "signature", label: "Signature", icon: PenLine },
  { type: "name", label: "Name Lastname", icon: User },
  { type: "initials", label: "Initials", icon: Type },
  { type: "date", label: "Date", icon: Calendar },
  { type: "text", label: "Text", icon: Type },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
];

export function EnvelopeEditor() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<EnvelopeDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [activeRecipientId, setActiveRecipientId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await api.getEnvelope(id);
    setDetail(d);
    setRecipients(d.recipients);
    setFields(d.fields);
    setActiveRecipientId((prev) => prev ?? d.recipients[0]?.id ?? null);
  }, [id]);

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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveRecipients(id, recipients);
      setRecipients(saved);
      await api.saveFields(id, fields);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const [sending, setSending] = useState(false);
  async function send() {
    if (dirty) await save();
    if (
      !window.confirm(
        "Send this document to all recipients for signature? Each will receive an email with their signing link.",
      )
    )
      return;
    setSending(true);
    setError(null);
    try {
      await api.sendEnvelope(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (!detail) {
    return <div className="p-8 text-center text-sm text-muted">{error ?? "Loading…"}</div>;
  }

  const hasPdf = !!detail.envelope.pdf_file;

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
            <StatusBadge status={detail.envelope.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
          <Button variant="outline" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            onClick={() => void send()}
            disabled={sending || detail.envelope.status !== "draft"}
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
            />
            <Card className="p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Fields
              </div>
              {recipients.length === 0 ? (
                <p className="text-xs text-muted">Add a recipient first, then place fields for them.</p>
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
                          (active
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-line hover:bg-canvas")
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
                  Click on the document to place a{" "}
                  <span className="font-medium">{activeTool}</span> field for{" "}
                  <span className="font-medium">{labelFor(activeRecipientId)}</span>.
                </p>
              )}
            </Card>
          </div>

          {/* Document */}
          <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-canvas p-4">
            <PdfCanvas
              url={api.documentUrl(id)}
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

function RecipientsPanel({
  recipients,
  activeId,
  onSelect,
  onAdd,
}: {
  recipients: Recipient[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, email: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  function submit() {
    if (!name.trim() || !email.trim()) return;
    onAdd(name.trim(), email.trim());
    setName("");
    setEmail("");
    setAdding(false);
  }

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Recipients</div>
        <button className="text-muted hover:text-brand" onClick={() => setAdding((v) => !v)}>
          <UserPlus className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {recipients.map((r, i) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id!)}
            className={
              "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors " +
              (activeId === r.id ? "border-brand bg-brand/5" : "border-line hover:bg-canvas")
            }
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
        ))}
        {recipients.length === 0 && !adding && (
          <p className="py-1 text-xs text-muted">No recipients yet.</p>
        )}
      </div>
      {adding ? (
        <div className="mt-2 space-y-2">
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.
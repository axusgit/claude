import { useState } from "react";
import { Eye, EyeOff, RefreshCw, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import type { DecFolder } from "@/lib/vault";
import { useVault } from "@/lib/vault";
import type { SecretField, SecretFields } from "@/lib/api";
import { DEFAULT_GEN, entropyBits, generatePassword } from "@/lib/password";

interface Props {
  folders: DecFolder[];
  defaultFolderId: string;
  initial?: { id: string; folderId: string; fields: SecretFields };
  onClose: () => void;
}

export function ItemEditor({ folders, defaultFolderId, initial, onClose }: Props) {
  const { saveItem } = useVault();
  // A locked confidential folder has no key this session, so it can't receive items.
  const writable = folders.filter((f) => f.canWrite && !!f.fk);
  const [folderId, setFolderId] = useState(initial?.folderId ?? defaultFolderId ?? writable[0]?.id ?? "");
  const [f, setF] = useState<SecretFields>(
    initial?.fields ?? { title: "", username: "", password: "", url: "", notes: "", custom: [] },
  );
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (patch: Partial<SecretFields>) => setF((prev) => ({ ...prev, ...patch }));
  const custom = f.custom ?? [];
  const setCustom = (next: SecretField[]) => set({ custom: next });

  async function save() {
    if (!f.title.trim()) return setErr("A title is required.");
    if (!folderId) return setErr("Choose a folder.");
    setBusy(true);
    setErr(null);
    try {
      const clean: SecretFields = {
        title: f.title.trim(),
        username: f.username?.trim() || undefined,
        password: f.password || undefined,
        url: f.url?.trim() || undefined,
        notes: f.notes?.trim() || undefined,
        totp: f.totp?.trim() || undefined,
        custom: custom.filter((c) => c.label.trim() || c.value.trim()),
      };
      await saveItem(folderId, clean, initial?.id);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const bits = entropyBits(f.password ?? "");
  const strength = bits >= 100 ? "Strong" : bits >= 60 ? "Good" : bits > 0 ? "Weak" : "";

  return (
    <Modal title={initial ? "Edit entry" : "New entry"} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div>
          <Label>Title *</Label>
          <Input autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} className="mt-1" placeholder="e.g. Core switch — admin" />
        </div>
        <div>
          <Label>Folder</Label>
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="mt-1">
            {writable.length === 0 && <option value="">(no writable folder)</option>}
            {writable.map((fl) => (
              <option key={fl.id} value={fl.id}>
                {fl.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Username</Label>
          <Input value={f.username ?? ""} onChange={(e) => set({ username: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Password</Label>
          <div className="mt-1 flex gap-2">
            <div className="relative flex-1">
              <Input
                type={show ? "text" : "password"}
                value={f.password ?? ""}
                onChange={(e) => set({ password: e.target.value })}
                className="pr-10 font-mono"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                onClick={() => setShow((s) => !s)}
                title={show ? "Hide" : "Show"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button type="button" variant="outline" onClick={() => { set({ password: generatePassword(DEFAULT_GEN) }); setShow(true); }} title="Generate">
              <RefreshCw className="h-4 w-4" /> Generate
            </Button>
          </div>
          {strength && (
            <p className="mt-1 text-xs text-muted">
              Strength: <span className={bits >= 100 ? "text-green-600" : bits >= 60 ? "text-amber-600" : "text-red-600"}>{strength}</span> (~{bits} bits)
            </p>
          )}
        </div>
        <div>
          <Label>URL</Label>
          <Input value={f.url ?? ""} onChange={(e) => set({ url: e.target.value })} className="mt-1" placeholder="https://…" />
        </div>
        <div>
          <Label>One-time code (TOTP)</Label>
          <Input value={f.totp ?? ""} onChange={(e) => set({ totp: e.target.value })} className="mt-1 font-mono text-xs" placeholder="base32 secret or otpauth:// URI (optional)" />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={3} value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} className="mt-1" />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>Custom fields</Label>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => setCustom([...custom, { label: "", value: "", hidden: false }])}>
              <Plus className="h-3.5 w-3.5" /> Add field
            </button>
          </div>
          {custom.map((c, i) => (
            <div key={i} className="mt-2 flex gap-2">
              <Input placeholder="Label" value={c.label} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="w-1/3" />
              <Input placeholder="Value" value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="flex-1" />
              <button type="button" className="text-muted hover:text-red-600" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || writable.length === 0}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

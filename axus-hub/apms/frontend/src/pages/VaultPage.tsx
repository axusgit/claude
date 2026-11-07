import { useEffect, useMemo, useState } from "react";
import {
  Search, Plus, Folder, FolderPlus, ChevronRight, ChevronDown, Pencil, Trash2,
  Copy, Eye, EyeOff, ExternalLink, KeyRound, Check, ListTree, ShieldCheck, Lock, LockOpen, Download,
} from "lucide-react";
import { Button, Card, Input, Label, Modal, Textarea } from "@/components/ui";
import { confirmDialog, promptDialog } from "@/lib/confirm";
import { useVault, type DecFolder, type DecItem } from "@/lib/vault";
import { api } from "@/lib/api";
import { copyWithAutoClear, fmtWhen } from "@/lib/utils";
import { totpNow } from "@/lib/crypto";
import { ItemEditor } from "./ItemEditor";

// The two people who own the confidential zone by default (pre-filled, editable).
const DEFAULT_CONF_OWNERS = ["acarr@axustechnologies.com", "jkahajas@axustechnologies.com"];

export function VaultPage() {
  const vault = useVault();
  const { folders, items } = vault;
  const [selected, setSelected] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id?: string; folderId: string; fields?: DecItem["fields"] } | null>(null);
  const [detail, setDetail] = useState<DecItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creatingConf, setCreatingConf] = useState(false);
  const [confRecoveryKey, setConfRecoveryKey] = useState<string | null>(null);
  const [changingSealId, setChangingSealId] = useState<string | null>(null);

  // Keep the open detail in sync after edits/reloads.
  useEffect(() => {
    if (detail) {
      const fresh = items.find((i) => i.id === detail.id);
      setDetail(fresh ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, DecFolder[]>();
    for (const f of folders) {
      const k = f.parentId;
      const list = m.get(k) ?? [];
      list.push(f);
      m.set(k, list);
    }
    return m;
  }, [folders]);

  const q = query.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    let list = items;
    if (q) {
      list = list.filter((i) => {
        const f = i.fields;
        return [f.title, f.username, f.url, f.notes].filter(Boolean).some((v) => v!.toLowerCase().includes(q));
      });
    } else if (selected !== "all") {
      list = list.filter((i) => i.folderId === selected);
    }
    return [...list].sort((a, b) => a.fields.title.localeCompare(b.fields.title));
  }, [items, q, selected]);

  const selectedFolder = selected !== "all" ? folders.find((f) => f.id === selected) : null;
  // A confidential folder selected but not yet unlocked this session.
  const lockedSealed = !!selectedFolder && selectedFolder.restricted && !selectedFolder.unlocked;
  // Items can only be added to a folder whose key is held this session (fk present).
  const canAddHere =
    selected !== "all" ? !!selectedFolder?.canWrite && !!selectedFolder?.fk : folders.some((f) => f.canWrite && f.fk);
  const defaultFolderId =
    selected !== "all" && selectedFolder?.fk ? selected : folders.find((f) => f.canWrite && f.fk)?.id ?? "";

  async function addFolder(parentId: string | null) {
    const name = await promptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create" });
    if (!name) return;
    setErr(null);
    try {
      await vault.createFolder(parentId, name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create folder");
    }
  }
  async function renameFolder(f: DecFolder) {
    const name = await promptDialog({ title: "Rename folder", defaultValue: f.name, confirmLabel: "Rename" });
    if (!name || name === f.name) return;
    setErr(null);
    try {
      await vault.renameFolder(f.id, name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename folder");
    }
  }
  async function deleteFolder(f: DecFolder) {
    const n = items.filter((i) => i.folderId === f.id).length;
    const ok = await confirmDialog({
      title: `Delete “${f.name}”?`,
      message: `This deletes the folder, its subfolders, and ${n} entr${n === 1 ? "y" : "ies"} inside it. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    if (selected === f.id) setSelected("all");
    await vault.deleteFolder(f.id);
  }

  const itemCount = (fid: string) => items.filter((i) => i.folderId === fid).length;

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <Card className="h-max p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Folders</span>
          {vault.isAdmin && (
            <div className="flex items-center gap-1">
              <button
                className="text-muted hover:text-brand"
                title="New confidential folder (second passphrase)"
                onClick={() => setCreatingConf(true)}
              >
                <ShieldCheck className="h-4 w-4" />
              </button>
              <button className="text-muted hover:text-brand" title="New top-level folder" onClick={() => addFolder(null)}>
                <FolderPlus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <button
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${selected === "all" ? "bg-brand/10 text-brand" : "text-ink hover:bg-canvas"}`}
          onClick={() => setSelected("all")}
        >
          <ListTree className="h-4 w-4" /> All items
          <span className="ml-auto text-xs text-muted">{items.length}</span>
        </button>
        <div className="mt-1">
          <Tree
            parent={null}
            childrenOf={childrenOf}
            selected={selected}
            onSelect={setSelected}
            isAdmin={vault.isAdmin}
            onAdd={addFolder}
            onRename={renameFolder}
            onDelete={deleteFolder}
            onLock={(f) => vault.lockSealedFolder(f.id)}
            count={itemCount}
            depth={0}
          />
          {folders.length === 0 && <p className="px-2 py-3 text-xs text-muted">No folders yet.</p>}
        </div>
      </Card>

      {/* Main */}
      <div className="space-y-3">
        {err && (
          <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <span>{err}</span>
            <button className="text-red-700/70 hover:text-red-700" onClick={() => setErr(null)}>×</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all entries…" className="pl-9" />
          </div>
          <Button onClick={() => setEditing({ folderId: defaultFolderId })} disabled={!canAddHere}>
            <Plus className="h-4 w-4" /> New entry
          </Button>
        </div>

        {lockedSealed && !q ? (
          <SealUnlockPanel folder={selectedFolder!} />
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-semibold">
              <span>{q ? `Search: “${query}”` : selectedFolder ? selectedFolder.name : "All items"}</span>
              {selectedFolder?.restricted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  <ShieldCheck className="h-3 w-3" /> Confidential
                </span>
              )}
              <span className="text-xs font-normal text-muted">{visibleItems.length} entr{visibleItems.length === 1 ? "y" : "ies"}</span>
              {selectedFolder?.restricted && selectedFolder.unlocked && (
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedFolder.canWrite && (
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-muted hover:text-ink"
                      onClick={() => setChangingSealId(selectedFolder.id)}
                      title="Change this folder's confidential passphrase"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Passphrase
                    </button>
                  )}
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-muted hover:text-ink"
                    onClick={() => vault.lockSealedFolder(selectedFolder.id)}
                    title="Lock this confidential folder now"
                  >
                    <Lock className="h-3.5 w-3.5" /> Lock
                  </button>
                </div>
              )}
            </div>
            {visibleItems.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted">
                {items.length === 0 ? "The vault is empty. Add an entry or import from KeePass." : "Nothing here."}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {visibleItems.map((it) => (
                  <li key={it.id}>
                    <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-canvas" onClick={() => setDetail(it)}>
                      <KeyRound className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{it.fields.title}</div>
                        {it.fields.username && <div className="truncate text-xs text-muted">{it.fields.username}</div>}
                      </div>
                      <CopyBtn label="password" value={it.fields.password} itemId={it.id} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {editing && (
        <ItemEditor
          folders={folders}
          defaultFolderId={editing.folderId}
          initial={editing.id ? { id: editing.id, folderId: editing.folderId, fields: editing.fields! } : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {detail && (
        <ItemDetail
          item={detail}
          folderName={folders.find((f) => f.id === detail.folderId)?.name ?? ""}
          canWrite={folders.find((f) => f.id === detail.folderId)?.canWrite ?? false}
          onEdit={() => { setEditing({ id: detail.id, folderId: detail.folderId, fields: detail.fields }); setDetail(null); }}
          onDelete={async () => {
            const ok = await confirmDialog({ title: `Delete “${detail.fields.title}”?`, message: "This entry will be permanently removed.", confirmLabel: "Delete", danger: true });
            if (!ok) return;
            await vault.deleteItem(detail.id);
            setDetail(null);
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {creatingConf && (
        <ConfidentialCreateModal
          onClose={() => setCreatingConf(false)}
          onCreated={(recoveryKey, newId) => {
            setCreatingConf(false);
            setConfRecoveryKey(recoveryKey);
            setSelected(newId);
          }}
        />
      )}
      {confRecoveryKey && (
        <RecoveryKeyModal recoveryKey={confRecoveryKey} onClose={() => setConfRecoveryKey(null)} />
      )}
      {changingSealId && (
        <ChangeSealPassphraseModal folderId={changingSealId} onClose={() => setChangingSealId(null)} />
      )}
    </div>
  );
}

function Tree({
  parent, childrenOf, selected, onSelect, isAdmin, onAdd, onRename, onDelete, onLock, count, depth,
}: {
  parent: string | null;
  childrenOf: Map<string | null, DecFolder[]>;
  selected: string | "all";
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onAdd: (parentId: string | null) => void;
  onRename: (f: DecFolder) => void;
  onDelete: (f: DecFolder) => void;
  onLock: (f: DecFolder) => void;
  count: (fid: string) => number;
  depth: number;
}) {
  const list = childrenOf.get(parent) ?? [];
  return (
    <>
      {list.map((f) => (
        <FolderNode key={f.id} f={f} childrenOf={childrenOf} selected={selected} onSelect={onSelect} isAdmin={isAdmin} onAdd={onAdd} onRename={onRename} onDelete={onDelete} onLock={onLock} count={count} depth={depth} />
      ))}
    </>
  );
}

function FolderNode({
  f, childrenOf, selected, onSelect, isAdmin, onAdd, onRename, onDelete, onLock, count, depth,
}: {
  f: DecFolder;
  childrenOf: Map<string | null, DecFolder[]>;
  selected: string | "all";
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onAdd: (parentId: string | null) => void;
  onRename: (f: DecFolder) => void;
  onDelete: (f: DecFolder) => void;
  onLock: (f: DecFolder) => void;
  count: (fid: string) => number;
  depth: number;
}) {
  const kids = childrenOf.get(f.id) ?? [];
  const [open, setOpen] = useState(depth < 1);
  const active = selected === f.id;
  // Confidential folders are flat (no subfolders) and lock/unlock instead.
  const FolderIcon = f.restricted ? (f.unlocked ? LockOpen : Lock) : Folder;
  return (
    <div>
      <div className={`group flex items-center gap-1 rounded-md pr-1 ${active ? "bg-brand/10" : "hover:bg-canvas"}`} style={{ paddingLeft: depth * 12 }}>
        <button className="p-1 text-muted" onClick={() => setOpen((o) => !o)} style={{ visibility: kids.length ? "visible" : "hidden" }}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button className={`flex flex-1 items-center gap-2 py-1.5 text-left text-sm ${active ? "text-brand" : "text-ink"}`} onClick={() => onSelect(f.id)}>
          <FolderIcon className={`h-4 w-4 shrink-0 ${f.restricted ? "text-amber-600" : ""}`} />
          <span className="truncate">{f.name}</span>
          {f.restricted && !f.unlocked && <span className="text-[10px] uppercase tracking-wide text-amber-600">locked</span>}
          <span className="ml-auto text-xs text-muted">{f.unlocked || !f.restricted ? count(f.id) : "–"}</span>
        </button>
        <div className="hidden items-center gap-0.5 group-hover:flex">
          {f.restricted && f.unlocked && (
            <button className="p-1 text-muted hover:text-brand" title="Lock now" onClick={() => onLock(f)}><Lock className="h-3.5 w-3.5" /></button>
          )}
          {f.canWrite && !f.restricted && (
            <button className="p-1 text-muted hover:text-brand" title="New subfolder" onClick={() => onAdd(f.id)}><FolderPlus className="h-3.5 w-3.5" /></button>
          )}
          {f.canWrite && f.unlocked && (
            <button className="p-1 text-muted hover:text-brand" title="Rename" onClick={() => onRename(f)}><Pencil className="h-3.5 w-3.5" /></button>
          )}
          {isAdmin && f.canWrite && (f.unlocked || !f.restricted) && (
            <button className="p-1 text-muted hover:text-red-600" title="Delete" onClick={() => onDelete(f)}><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
      {open && kids.length > 0 && (
        <Tree parent={f.id} childrenOf={childrenOf} selected={selected} onSelect={onSelect} isAdmin={isAdmin} onAdd={onAdd} onRename={onRename} onDelete={onDelete} onLock={onLock} count={count} depth={depth + 1} />
      )}
    </div>
  );
}

function CopyBtn({ label, value, itemId }: { label: string; value?: string; itemId: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className="rounded-md p-1.5 text-muted hover:bg-brand/10 hover:text-brand"
      title={`Copy ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        void copyWithAutoClear(value);
        void api.logEvent("copy", itemId);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </span>
  );
}

function Field({ label, value, mono, itemId, secret }: { label: string; value?: string; mono?: boolean; itemId: string; secret?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 border-b border-line py-2 last:border-0">
      <div className="w-24 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`min-w-0 flex-1 break-words text-sm ${mono ? "font-mono" : ""}`}>
        {secret && !show ? "••••••••••••" : value}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {secret && (
          <button className="p-1 text-muted hover:text-ink" onClick={() => { setShow((s) => !s); if (!show) void api.logEvent("reveal", itemId); }} title={show ? "Hide" : "Reveal"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button className="p-1 text-muted hover:text-brand" onClick={() => { void copyWithAutoClear(value); void api.logEvent("copy", itemId); setCopied(true); setTimeout(() => setCopied(false), 1200); }} title="Copy">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function TotpView({ secret }: { secret: string }) {
  const [state, setState] = useState<{ code: string; secondsLeft: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await totpNow(secret);
      if (alive) setState(r);
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [secret]);
  if (!state) return <span className="text-sm text-muted">invalid TOTP secret</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-lg tracking-widest">{state.code.replace(/(\d{3})(\d+)/, "$1 $2")}</span>
      <span className="text-xs text-muted">{state.secondsLeft}s</span>
    </div>
  );
}

function ItemDetail({
  item, folderName, canWrite, onEdit, onDelete, onClose,
}: {
  item: DecItem;
  folderName: string;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const f = item.fields;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{f.title}</h3>
          <div className="flex items-center gap-1">
            {canWrite && <button className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink" onClick={onEdit} title="Edit"><Pencil className="h-4 w-4" /></button>}
            {canWrite && <button className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={onDelete} title="Delete"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">{folderName} · updated {fmtWhen(item.updatedAt)} by {item.updatedBy}</p>

        <div>
          <Field label="Username" value={f.username} itemId={item.id} />
          <Field label="Password" value={f.password} mono secret itemId={item.id} />
          {f.url && (
            <div className="flex items-center gap-2 border-b border-line py-2">
              <div className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">URL</div>
              <a href={f.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-brand hover:underline">
                <span className="truncate">{f.url}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          )}
          {f.totp && (
            <div className="flex items-center gap-2 border-b border-line py-2">
              <div className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">One-time</div>
              <div className="flex-1"><TotpView secret={f.totp} /></div>
            </div>
          )}
          {(f.custom ?? []).filter((c) => c.label || c.value).map((c, i) => (
            <Field key={i} label={c.label || "Field"} value={c.value} itemId={item.id} secret={c.hidden} />
          ))}
          {f.notes && (
            <div className="py-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Notes</div>
              <p className="whitespace-pre-wrap text-sm text-ink">{f.notes}</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </div>
  );
}

// Shown in the main area when an owner selects a confidential folder that hasn't
// been unlocked this session. Prompts for the SECOND (confidential) passphrase,
// with an owner-only recovery path.
function SealUnlockPanel({ folder }: { folder: DecFolder }) {
  const { unlockSealedFolder, recoverSealedFolder } = useVault();
  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [pass, setPass] = useState("");
  const [recKey, setRecKey] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await unlockSealedFolder(folder.id, pass);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Unlock failed");
      setPass("");
    } finally {
      setBusy(false);
    }
  }

  async function doRecover(e: React.FormEvent) {
    e.preventDefault();
    if (newPass.length < 12) return setErr("New confidential passphrase must be at least 12 characters.");
    if (newPass !== newPass2) return setErr("New passphrases don't match.");
    setBusy(true);
    setErr(null);
    try {
      await recoverSealedFolder(folder.id, recKey, newPass);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <Lock className="h-5 w-5 text-amber-600" />
        <h2 className="text-base font-semibold">“{folder.name}” is confidential</h2>
      </div>
      <p className="mb-4 max-w-xl text-sm text-muted">
        This folder is sealed with its own passphrase, separate from the vault passphrase. Even other admins can't
        see its contents. Enter the confidential passphrase to unlock it for this session.
      </p>

      {mode === "unlock" ? (
        <form onSubmit={doUnlock} className="max-w-sm space-y-3">
          <div>
            <Label>Confidential passphrase</Label>
            <Input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} className="mt-1" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !pass}>{busy ? "Unlocking…" : "Unlock"}</Button>
            {folder.canWrite && (
              <button type="button" className="text-xs text-brand hover:underline" onClick={() => { setMode("recover"); setErr(null); }}>
                Forgot it? Use the recovery key
              </button>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={doRecover} className="max-w-sm space-y-3">
          <div>
            <Label>Recovery key</Label>
            <Textarea rows={3} value={recKey} onChange={(e) => setRecKey(e.target.value)} className="mt-1 font-mono text-xs" placeholder="Base64 recovery key for this folder…" />
          </div>
          <div>
            <Label>New confidential passphrase</Label>
            <Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Confirm</Label>
            <Input type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} className="mt-1" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Recovering…" : "Recover & set passphrase"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setMode("unlock"); setErr(null); }}>Back</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// Admin dialog to create a confidential folder: a name, a second passphrase, and
// the explicit list of owners who may see it. On success the caller shows the
// one-time recovery key.
function ConfidentialCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (recoveryKey: string, folderId: string) => void;
}) {
  const { createSealedFolder } = useVault();
  const [name, setName] = useState("Confidential");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [owners, setOwners] = useState(DEFAULT_CONF_OWNERS.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    const ownerList = owners.split(",").map((o) => o.trim().toLowerCase()).filter((o) => o.includes("@"));
    if (!name.trim()) return setErr("Give the folder a name.");
    if (ownerList.length === 0) return setErr("List at least one owner email.");
    if (pass.length < 12) return setErr("Confidential passphrase must be at least 12 characters.");
    if (pass !== pass2) return setErr("Passphrases don't match.");
    setBusy(true);
    setErr(null);
    try {
      const { id, recoveryKey } = await createSealedFolder(name.trim(), pass, ownerList);
      onCreated(recoveryKey, id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the confidential folder");
      setBusy(false);
    }
  }

  return (
    <Modal title="New confidential folder" onClose={busy ? () => {} : onClose} width="max-w-md">
      <div className="space-y-3">
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          This folder is sealed under a <strong>second passphrase</strong> and visible only to the owners listed below —
          not to other admins. Anyone else, and even a database backup, cannot read it without this passphrase.
        </div>
        <div>
          <Label>Folder name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>Owners (comma-separated emails)</Label>
          <Input value={owners} onChange={(e) => setOwners(e.target.value)} className="mt-1" placeholder="name@axustechnologies.com, …" />
          <p className="mt-1 text-xs text-muted">Only these people will see the folder. They also need the confidential passphrase to open it.</p>
        </div>
        <div>
          <Label>Confidential passphrase</Label>
          <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="mt-1" placeholder="At least 12 characters" />
        </div>
        <div>
          <Label>Confirm passphrase</Label>
          <Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} className="mt-1" />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create confidential folder"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// One-time display of a confidential folder's recovery key.
function RecoveryKeyModal({ recoveryKey, onClose }: { recoveryKey: string; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const blob = new Blob(
      [
        "Axus Password Management — CONFIDENTIAL FOLDER RECOVERY KEY\n",
        "Keep this offline and secure. It can recover this one confidential folder\n",
        "if its passphrase is lost. Anyone with this key can reset that passphrase.\n\n",
        recoveryKey,
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apms-confidential-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <Modal title="Save the confidential recovery key" onClose={saved ? onClose : () => {}} width="max-w-md">
      <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        Shown <strong>once</strong>. Store it offline, separately from the vault recovery key. If the confidential
        passphrase is ever lost, this is the only way to recover this folder.
      </div>
      <Textarea readOnly rows={4} value={recoveryKey} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={() => { navigator.clipboard.writeText(recoveryKey); setCopied(true); }} className="flex-1">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" onClick={download} className="flex-1">
          <Download className="h-4 w-4" /> Download
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I have saved the recovery key somewhere safe.
      </label>
      <Button className="mt-3 w-full" disabled={!saved} onClick={onClose}>Done</Button>
    </Modal>
  );
}

// Change the confidential passphrase for an unlocked sealed folder.
function ChangeSealPassphraseModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { changeSealedPassphrase } = useVault();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (p1.length < 12) return setErr("Passphrase must be at least 12 characters.");
    if (p1 !== p2) return setErr("Passphrases don't match.");
    setBusy(true);
    setErr(null);
    try {
      await changeSealedPassphrase(folderId, p1);
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change the passphrase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change confidential passphrase" onClose={onClose} width="max-w-md">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-green-600">
            Passphrase changed. Share the new one with the other owners through a secure channel — they'll use it to
            unlock the folder next time. The recovery key is unchanged.
          </p>
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Re-wraps this folder under a new confidential passphrase. No data is re-encrypted, and the recovery key
            still works.
          </p>
          <div>
            <Label>New confidential passphrase</Label>
            <Input type="password" value={p1} onChange={(e) => setP1(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Confirm</Label>
            <Input type="password" value={p2} onChange={(e) => setP2(e.target.value)} className="mt-1" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Change passphrase"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

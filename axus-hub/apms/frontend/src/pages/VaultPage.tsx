import { useEffect, useMemo, useState } from "react";
import {
  Search, Plus, Folder, FolderPlus, ChevronRight, ChevronDown, Pencil, Trash2,
  Copy, Eye, EyeOff, ExternalLink, KeyRound, Check, ListTree,
} from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { confirmDialog, promptDialog } from "@/lib/confirm";
import { useVault, type DecFolder, type DecItem } from "@/lib/vault";
import { api } from "@/lib/api";
import { copyWithAutoClear, fmtWhen } from "@/lib/utils";
import { totpNow } from "@/lib/crypto";
import { ItemEditor } from "./ItemEditor";

export function VaultPage() {
  const vault = useVault();
  const { folders, items } = vault;
  const [selected, setSelected] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id?: string; folderId: string; fields?: DecItem["fields"] } | null>(null);
  const [detail, setDetail] = useState<DecItem | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
  const canAddHere = selected !== "all" ? !!selectedFolder?.canWrite : folders.some((f) => f.canWrite);
  const defaultFolderId = selected !== "all" ? selected : folders.find((f) => f.canWrite)?.id ?? "";

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
            <button className="text-muted hover:text-brand" title="New top-level folder" onClick={() => addFolder(null)}>
              <FolderPlus className="h-4 w-4" />
            </button>
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

        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            {q ? `Search: “${query}”` : selectedFolder ? selectedFolder.name : "All items"}
            <span className="ml-2 text-xs font-normal text-muted">{visibleItems.length} entr{visibleItems.length === 1 ? "y" : "ies"}</span>
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
    </div>
  );
}

function Tree({
  parent, childrenOf, selected, onSelect, isAdmin, onAdd, onRename, onDelete, count, depth,
}: {
  parent: string | null;
  childrenOf: Map<string | null, DecFolder[]>;
  selected: string | "all";
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onAdd: (parentId: string | null) => void;
  onRename: (f: DecFolder) => void;
  onDelete: (f: DecFolder) => void;
  count: (fid: string) => number;
  depth: number;
}) {
  const list = childrenOf.get(parent) ?? [];
  return (
    <>
      {list.map((f) => (
        <FolderNode key={f.id} f={f} childrenOf={childrenOf} selected={selected} onSelect={onSelect} isAdmin={isAdmin} onAdd={onAdd} onRename={onRename} onDelete={onDelete} count={count} depth={depth} />
      ))}
    </>
  );
}

function FolderNode({
  f, childrenOf, selected, onSelect, isAdmin, onAdd, onRename, onDelete, count, depth,
}: {
  f: DecFolder;
  childrenOf: Map<string | null, DecFolder[]>;
  selected: string | "all";
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onAdd: (parentId: string | null) => void;
  onRename: (f: DecFolder) => void;
  onDelete: (f: DecFolder) => void;
  count: (fid: string) => number;
  depth: number;
}) {
  const kids = childrenOf.get(f.id) ?? [];
  const [open, setOpen] = useState(depth < 1);
  const active = selected === f.id;
  return (
    <div>
      <div className={`group flex items-center gap-1 rounded-md pr-1 ${active ? "bg-brand/10" : "hover:bg-canvas"}`} style={{ paddingLeft: depth * 12 }}>
        <button className="p-1 text-muted" onClick={() => setOpen((o) => !o)} style={{ visibility: kids.length ? "visible" : "hidden" }}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button className={`flex flex-1 items-center gap-2 py-1.5 text-left text-sm ${active ? "text-brand" : "text-ink"}`} onClick={() => onSelect(f.id)}>
          <Folder className="h-4 w-4 shrink-0" />
          <span className="truncate">{f.name}</span>
          <span className="ml-auto text-xs text-muted">{count(f.id)}</span>
        </button>
        {f.canWrite && (
          <div className="hidden items-center gap-0.5 group-hover:flex">
            <button className="p-1 text-muted hover:text-brand" title="New subfolder" onClick={() => onAdd(f.id)}><FolderPlus className="h-3.5 w-3.5" /></button>
            <button className="p-1 text-muted hover:text-brand" title="Rename" onClick={() => onRename(f)}><Pencil className="h-3.5 w-3.5" /></button>
            {isAdmin && <button className="p-1 text-muted hover:text-red-600" title="Delete" onClick={() => onDelete(f)}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        )}
      </div>
      {open && kids.length > 0 && (
        <Tree parent={f.id} childrenOf={childrenOf} selected={selected} onSelect={onSelect} isAdmin={isAdmin} onAdd={onAdd} onRename={onRename} onDelete={onDelete} count={count} depth={depth + 1} />
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

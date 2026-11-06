import { useEffect, useState } from "react";
import { Users, Plus, Trash2, KeyRound, ScrollText, Shield } from "lucide-react";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { api, type AccessGrant, type AuditEvent } from "@/lib/api";
import { useVault } from "@/lib/vault";

const SUGGESTED_GROUPS = ["app-apms", "apms-role-admin", "apms-role-user"];

export function AdminPage() {
  return (
    <div className="space-y-4">
      <FolderAccess />
      <ChangePassphrase />
      <AuditLog />
    </div>
  );
}

function FolderAccess() {
  const { folders } = useVault();
  const [folderId, setFolderId] = useState("");
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [kind, setKind] = useState<"group" | "user">("group");
  const [value, setValue] = useState("");
  const [canWrite, setCanWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!folderId && folders.length) setFolderId(folders[0].id);
  }, [folders, folderId]);

  useEffect(() => {
    if (!folderId) return;
    api.getFolderAccess(folderId).then((r) => setGrants(r.grants)).catch(() => setGrants([]));
  }, [folderId]);

  function folderPath(id: string): string {
    const parts: string[] = [];
    let cur = folders.find((f) => f.id === id);
    let guard = 0;
    while (cur && guard++ < 50) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    return parts.join(" / ");
  }

  function addGrant() {
    const v = value.trim();
    if (!v) return;
    const principal = `${kind}:${kind === "user" ? v.toLowerCase() : v}`;
    if (grants.some((g) => g.principal === principal)) return;
    setGrants([...grants, { principal, can_write: canWrite }]);
    setValue("");
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.setFolderAccess(folderId, grants);
      setNotice("Access saved. It applies to this folder and everything under it.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save access");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-5 w-5 text-brand" />
        <h2 className="text-base font-semibold">Folder access</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Grant a group or person access to a folder. Access is inherited by every subfolder. Admins always have full
        access. A folder with no grants is visible only to admins.
      </p>

      {folders.length === 0 ? (
        <p className="text-sm text-muted">Create a folder first.</p>
      ) : (
        <>
          <div className="mb-3">
            <Label>Folder</Label>
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="mt-1">
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{folderPath(f.id)}</option>
              ))}
            </Select>
          </div>

          <div className="rounded-lg border border-line">
            {grants.length === 0 ? (
              <p className="p-3 text-sm text-muted">No grants — admins only.</p>
            ) : (
              <ul className="divide-y divide-line">
                {grants.map((g) => (
                  <li key={g.principal} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${g.principal.startsWith("user:") ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>
                      {g.principal.startsWith("user:") ? "user" : "group"}
                    </span>
                    <span className="flex-1 truncate">{g.principal.split(":").slice(1).join(":")}</span>
                    <span className="text-xs text-muted">{g.can_write ? "read + write" : "read-only"}</span>
                    <button className="text-muted hover:text-red-600" onClick={() => setGrants(grants.filter((x) => x.principal !== g.principal))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as "group" | "user")} className="mt-1 w-28">
                <option value="group">Group</option>
                <option value="user">User</option>
              </Select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">{kind === "user" ? "Email" : "Group name"}</Label>
              <Input
                className="mt-1"
                list={kind === "group" ? "apms-groups" : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === "user" ? "name@axustechnologies.com" : "app-apms"}
                onKeyDown={(e) => e.key === "Enter" && addGrant()}
              />
              {kind === "group" && (
                <datalist id="apms-groups">
                  {SUGGESTED_GROUPS.map((g) => <option key={g} value={g} />)}
                </datalist>
              )}
            </div>
            <div>
              <Label className="text-xs">Access</Label>
              <Select value={canWrite ? "rw" : "r"} onChange={(e) => setCanWrite(e.target.value === "rw")} className="mt-1 w-36">
                <option value="rw">Read + write</option>
                <option value="r">Read-only</option>
              </Select>
            </div>
            <Button variant="outline" onClick={addGrant}><Plus className="h-4 w-4" /> Add</Button>
          </div>

          {notice && <p className="mt-3 text-sm text-green-600">{notice}</p>}
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save access"}</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ChangePassphrase() {
  const { changePassphrase } = useVault();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (p1.length < 12) return setErr("Passphrase must be at least 12 characters.");
    if (p1 !== p2) return setErr("Passphrases don't match.");
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await changePassphrase(p1);
      setP1("");
      setP2("");
      setNotice("Passphrase changed. Share the new passphrase with the team — everyone uses it to unlock next time.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change passphrase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-brand" />
        <h2 className="text-base font-semibold">Change the shared passphrase</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Re-wraps the vault under a new passphrase (no data is re-encrypted). The recovery key is unchanged. Tell the
        team the new passphrase through a secure channel.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <Label className="text-xs">New passphrase</Label>
          <Input type="password" className="mt-1" value={p1} onChange={(e) => setP1(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <Label className="text-xs">Confirm</Label>
          <Input type="password" className="mt-1" value={p2} onChange={(e) => setP2(e.target.value)} />
        </div>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Change"}</Button>
      </div>
      {notice && <p className="mt-3 text-sm text-green-600">{notice}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAudit(200).then((r) => setEvents(r.events)).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <ScrollText className="h-5 w-5 text-brand" />
        <h2 className="text-base font-semibold">Access log</h2>
      </div>
      {loading ? (
        <div className="p-6 text-center text-sm text-muted">Loading…</div>
      ) : events.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted">No activity yet.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-5 py-2 text-left font-medium">When (ET)</th>
                <th className="px-3 py-2 text-left font-medium">Who</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-5 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-5 py-1.5 text-xs text-muted">
                    {new Date(e.ts).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{e.actor}</td>
                  <td className="px-3 py-1.5"><span className="rounded bg-canvas px-1.5 py-0.5 text-xs">{e.action}</span></td>
                  <td className="px-5 py-1.5 text-xs text-muted">{e.detail ?? e.target ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t border-line px-5 py-2 text-xs text-muted">
        <Shield className="h-3.5 w-3.5" /> No secret values are ever logged — only who did what, and when.
      </div>
    </Card>
  );
}

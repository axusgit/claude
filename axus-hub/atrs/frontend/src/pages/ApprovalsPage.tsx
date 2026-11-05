import { useEffect, useMemo, useState } from "react";
import { Check, Inbox, Undo2, Users } from "lucide-react";
import { api, type Me, type TimeEntry, type WorkerTotal } from "@/lib/api";
import { Button, Card, Input, Label, Modal, StatusBadge, Textarea } from "@/components/ui";
import { fmtDate, fmtHours } from "@/lib/utils";

export function ApprovalsPage({ me: _me }: { me: Me }) {
  const [pending, setPending] = useState<TimeEntry[]>([]);
  const [history, setHistory] = useState<TimeEntry[]>([]);
  const [workers, setWorkers] = useState<WorkerTotal[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workerFilter, setWorkerFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadPending() {
    const r = await api.listEntries({ status: "submitted" });
    setPending(r.entries);
  }
  async function loadHistory() {
    const r = await api.listEntries({
      scope: "all",
      from: from || undefined,
      to: to || undefined,
      worker: workerFilter || undefined,
    });
    setHistory(r.entries);
  }
  async function loadSummary() {
    const r = await api.summary({ from: from || undefined, to: to || undefined });
    setWorkers(r.byWorker ?? []);
  }
  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadPending(), loadHistory(), loadSummary()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group the pending queue by contractor.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; entries: TimeEntry[] }>();
    for (const e of pending) {
      const g = m.get(e.worker_email) ?? { name: e.worker_name ?? e.worker_email, entries: [] };
      g.entries.push(e);
      m.set(e.worker_email, g);
    }
    return [...m.entries()];
  }, [pending]);

  const selectedHours = useMemo(
    () => pending.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.hours, 0),
    [pending, selected],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleGroup(entries: TimeEntry[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const e of entries) {
        if (on) n.add(e.id);
        else n.delete(e.id);
      }
      return n;
    });
  }

  async function approve(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.decide(ids, "approved");
      setSelected(new Set());
      setNotice(`Approved ${r.decided} ${r.decided === 1 ? "entry" : "entries"}. The contractor was emailed.`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve");
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!rejectIds || !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.decide(rejectIds, "rejected", note.trim());
      setRejectIds(null);
      setNote("");
      setSelected(new Set());
      setNotice(`Returned ${r.decided} ${r.decided === 1 ? "entry" : "entries"} for changes. The contractor was emailed.`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not return");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Per-contractor totals */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <Users className="h-4 w-4 text-brand" /> Contractors
          <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted">
            <span>Period:</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto px-2 py-1" />
            <span>→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto px-2 py-1" />
            <Button variant="outline" className="h-8 px-2.5 py-1" onClick={() => void loadAll()}>
              Apply
            </Button>
          </span>
        </div>
        {workers.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">No contractors yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Contractor</th>
                <th className="px-4 py-2 text-right font-medium">Approved (h)</th>
                <th className="px-4 py-2 text-right font-medium">Pending (h)</th>
                <th className="px-4 py-2 text-right font-medium">Pending #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {workers.map((w) => (
                <tr key={w.worker_email}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{w.worker_name ?? w.worker_email}</div>
                    <div className="text-xs text-muted">{w.worker_email}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-green-600">{fmtHours(w.approved_hours)}</td>
                  <td className="px-4 py-2 text-right text-amber-600">{fmtHours(w.submitted_hours)}</td>
                  <td className="px-4 py-2 text-right text-muted">{w.submitted_n || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {notice && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Pending approvals */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          <Inbox className="h-4 w-4 text-brand" /> Pending approval
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{pending.length}</span>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted">
                {selected.size} selected · {fmtHours(selectedHours)} h
              </span>
              <Button className="h-8 px-2.5 py-1" onClick={() => void approve([...selected])} disabled={busy}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="danger" className="h-8 px-2.5 py-1" onClick={() => setRejectIds([...selected])} disabled={busy}>
                <Undo2 className="h-4 w-4" /> Return
              </Button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">Nothing awaiting approval. 🎉</div>
        ) : (
          <div className="divide-y divide-line">
            {groups.map(([email, g]) => {
              const allOn = g.entries.every((e) => selected.has(e.id));
              const groupHours = g.entries.reduce((s, e) => s + e.hours, 0);
              return (
                <div key={email}>
                  <div className="flex items-center gap-2 bg-canvas/60 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={(e) => toggleGroup(g.entries, e.target.checked)}
                      className="h-4 w-4 accent-brand"
                    />
                    <span className="text-sm font-semibold">{g.name}</span>
                    <span className="text-xs text-muted">
                      {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} · {fmtHours(groupHours)} h
                    </span>
                    <div className="ml-auto flex gap-1">
                      <Button variant="outline" className="h-7 px-2 py-0.5 text-xs" onClick={() => void approve(g.entries.map((e) => e.id))} disabled={busy}>
                        Approve all
                      </Button>
                      <Button variant="ghost" className="h-7 px-2 py-0.5 text-xs text-red-600" onClick={() => setRejectIds(g.entries.map((e) => e.id))} disabled={busy}>
                        Return all
                      </Button>
                    </div>
                  </div>
                  {g.entries.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 px-4 py-3 pl-8">
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        className="mt-0.5 h-4 w-4 accent-brand"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-medium">{fmtDate(e.work_date)}</span>
                          <span className="text-sm text-muted">{e.start_time}–{e.end_time}</span>
                          <span className="text-sm font-semibold">{fmtHours(e.hours)} h</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-ink/80">{e.task}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* History */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
          All entries
          <span className="ml-auto flex items-center gap-2 text-xs font-normal">
            <select
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-sm outline-none focus:border-brand"
            >
              <option value="">All contractors</option>
              {workers.map((w) => (
                <option key={w.worker_email} value={w.worker_email}>
                  {w.worker_name ?? w.worker_email}
                </option>
              ))}
            </select>
            <Button variant="outline" className="h-8 px-2.5 py-1" onClick={() => void loadHistory()}>
              Filter
            </Button>
          </span>
        </div>
        {history.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No entries in this range.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Contractor</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 text-right font-medium">Hours</th>
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2">{fmtDate(e.work_date)}</td>
                  <td className="px-4 py-2">{e.worker_name ?? e.worker_email}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{e.start_time}–{e.end_time}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmtHours(e.hours)}</td>
                  <td className="max-w-xs px-4 py-2"><div className="truncate" title={e.task}>{e.task}</div></td>
                  <td className="px-4 py-2"><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Return-for-changes modal (note required) */}
      {rejectIds && (
        <Modal title={`Return ${rejectIds.length} ${rejectIds.length === 1 ? "entry" : "entries"} for changes`} onClose={() => setRejectIds(null)}>
          <p className="mb-3 text-sm text-muted">
            The contractor will be emailed your note and can edit and resubmit.
          </p>
          <Label>Reason / note</Label>
          <Textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please split this into separate tasks, or confirm the end time."
            className="mt-1"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectIds(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void doReject()} disabled={!note.trim() || busy}>
              {busy ? "Returning…" : "Return for changes"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

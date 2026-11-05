import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Clock, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { api, type Me, type TimeEntry } from "@/lib/api";
import { Button, Card, Input, Label, StatusBadge, Textarea } from "@/components/ui";
import { confirmDialog } from "@/lib/confirm";
import { fmtDate, fmtHours, todayIso } from "@/lib/utils";

// Mirror of the backend hours calc, for a live preview as the person types.
function previewHours(start: string, end: string): number | null {
  const p = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const s = p(start);
  const e = p(end);
  if (s === null || e === null) return null;
  let diff = e - s;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

const BLANK = { work_date: todayIso(), start_time: "09:00", end_time: "17:00", task: "" };

export function TimesheetPage({ me: _me }: { me: Me }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.listEntries({ scope: "mine" });
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load entries");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const preview = previewHours(form.start_time, form.end_time);
  const canAdd = !!form.work_date && preview !== null && preview > 0 && form.task.trim().length > 0 && !busy;

  const totals = useMemo(() => {
    const t = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const e of entries) t[e.status] += e.hours;
    return t;
  }, [entries]);

  // Entries the contractor can still act on (select + submit).
  const actionable = entries.filter((e) => e.status === "draft" || e.status === "rejected");

  function resetForm() {
    setForm({ ...BLANK });
    setEditingId(null);
  }

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const body = { ...form, task: form.task.trim() };
      if (editingId) {
        await api.updateEntry(editingId, body);
        setNotice("Entry updated.");
      } else {
        await api.createEntry(body);
        setNotice("Entry added as a draft.");
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(e: TimeEntry) {
    setEditingId(e.id);
    setForm({ work_date: e.work_date, start_time: e.start_time, end_time: e.end_time, task: e.task });
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function del(e: TimeEntry) {
    const ok = await confirmDialog({
      title: "Delete this entry?",
      message: `${fmtDate(e.work_date)} · ${e.start_time}–${e.end_time} (${fmtHours(e.hours)} h). This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEntry(e.id);
      if (editingId === e.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit(ids: string[]) {
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Submit ${ids.length} ${ids.length === 1 ? "entry" : "entries"} for approval?`,
      message: "Once submitted, they're locked until an approver reviews them.",
      confirmLabel: "Submit",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.submit(ids);
      setSelected(new Set());
      setNotice(`Submitted ${r.submitted} ${r.submitted === 1 ? "entry" : "entries"} for approval.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalCard label="Draft" hours={totals.draft} tone="gray" />
        <TotalCard label="Pending approval" hours={totals.submitted} tone="amber" />
        <TotalCard label="Approved" hours={totals.approved} tone="green" />
        <TotalCard label="Returned" hours={totals.rejected} tone="red" />
      </div>

      {/* Log form */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="h-4 w-4 text-brand" />
          {editingId ? "Edit time entry" : "Log time"}
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Start</Label>
            <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>End</Label>
            <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Hours</Label>
            <div className="flex h-[38px] items-center gap-1.5 rounded-lg bg-canvas px-3 text-sm font-semibold text-ink">
              <Clock className="h-3.5 w-3.5 text-muted" />
              {preview !== null && preview > 0 ? fmtHours(preview) : "—"}
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Task description</Label>
          <Textarea
            rows={2}
            placeholder="What did you work on?"
            value={form.task}
            onChange={(e) => setForm({ ...form, task: e.target.value })}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => void save()} disabled={!canAdd}>
            {editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editingId ? "Save changes" : "Add entry"}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={resetForm}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
          {preview !== null && preview <= 0 && (
            <span className="text-xs text-red-600">End must be after start.</span>
          )}
        </div>
      </Card>

      {notice && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Submit bar */}
      {actionable.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-sm text-muted">
            {selected.size > 0
              ? `${selected.size} selected`
              : `${actionable.length} draft/returned ${actionable.length === 1 ? "entry" : "entries"} ready to submit`}
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <Button onClick={() => void submit([...selected])} disabled={busy}>
                <Send className="h-4 w-4" /> Submit selected ({selected.size})
              </Button>
            )}
            <Button variant={selected.size > 0 ? "outline" : "primary"} onClick={() => void submit(actionable.map((e) => e.id))} disabled={busy}>
              <Send className="h-4 w-4" /> Submit all
            </Button>
          </div>
        </div>
      )}

      {/* Entries */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold">My time entries</div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No entries yet. Log your first above.</div>
        ) : (
          <div className="divide-y divide-line">
            {entries.map((e) => {
              const selectable = e.status === "draft" || e.status === "rejected";
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="pt-0.5">
                    {selectable ? (
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        className="h-4 w-4 accent-brand"
                      />
                    ) : (
                      <div className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium">{fmtDate(e.work_date)}</span>
                      <span className="text-sm text-muted">
                        {e.start_time}–{e.end_time}
                      </span>
                      <span className="text-sm font-semibold">{fmtHours(e.hours)} h</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-ink/80">{e.task}</div>
                    {e.status === "rejected" && e.decision_note && (
                      <div className="mt-1.5 rounded-md border-l-2 border-red-400 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                        <span className="font-medium">Returned:</span> {e.decision_note}
                      </div>
                    )}
                  </div>
                  {selectable && (
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => startEdit(e)} className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => void del(e)} className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-600" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function TotalCard({ label, hours, tone }: { label: string; hours: number; tone: "gray" | "amber" | "green" | "red" }) {
  const tones: Record<string, string> = {
    gray: "text-gray-600",
    amber: "text-amber-600",
    green: "text-green-600",
    red: "text-red-600",
  };
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{fmtHours(hours)}<span className="ml-1 text-sm font-medium text-muted">h</span></div>
    </Card>
  );
}

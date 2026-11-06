import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { api, type Me, type TimeEntry, type Category, CATEGORIES, CATEGORY_LABEL, categoryLabel } from "@/lib/api";
import { Button, Card, Input, Select } from "@/components/ui";
import { fmtDate, fmtHours, fmtMoney } from "@/lib/utils";

// Pay applies to worked time only; leave categories are tracked as hours, not
// auto-valued (whether/how to pay leave to a 1099 is a policy call).
function entryPay(e: TimeEntry): number {
  return e.category === "work" ? e.hours * e.rate : 0;
}

// --- period helpers (weeks start Sunday, matching the ATRS work week) --------
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
type Preset = "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom" },
];
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  switch (p) {
    case "this_week":
      return { from: iso(new Date(y, m, d - dow)), to: iso(new Date(y, m, d - dow + 6)) };
    case "last_week":
      return { from: iso(new Date(y, m, d - dow - 7)), to: iso(new Date(y, m, d - dow - 1)) };
    case "this_month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last_month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this_year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return { from: iso(new Date(y, m, d - dow)), to: iso(new Date(y, m, d - dow + 6)) };
  }
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, rows: string[][]): void {
  const text = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STATUS_ORDER: { key: TimeEntry["status"]; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "submitted", label: "Pending" },
  { key: "draft", label: "Draft" },
  { key: "rejected", label: "Returned" },
];

export function ReportsPage({ me }: { me: Me }) {
  const isAdmin = me.role === "admin";
  const [preset, setPreset] = useState<Preset>("this_week");
  const init = presetRange("this_week");
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [worker, setWorker] = useState<string>("all"); // admin contractor filter
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .listEntries({ scope: isAdmin ? "all" : "mine", from, to })
      .then((r) => {
        if (live) setEntries(r.entries);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load report");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [isAdmin, from, to]);

  const filtered = useMemo(
    () => (worker === "all" ? entries : entries.filter((e) => e.worker_email === worker)),
    [entries, worker],
  );

  // Worker options (admins): everyone with time in the period.
  const workers = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.worker_email, e.worker_name ?? e.worker_email);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const byCategory = useMemo(() => {
    const m = new Map<Category, { hours: number; n: number }>();
    for (const c of CATEGORIES) m.set(c, { hours: 0, n: 0 });
    for (const e of filtered) {
      const g = m.get(e.category) ?? { hours: 0, n: 0 };
      g.hours += e.hours;
      g.n += 1;
      m.set(e.category, g);
    }
    return m;
  }, [filtered]);

  const byStatus = useMemo(() => {
    const m = new Map<TimeEntry["status"], number>();
    for (const e of filtered) m.set(e.status, (m.get(e.status) ?? 0) + e.hours);
    return m;
  }, [filtered]);

  const byWorker = useMemo(() => {
    const m = new Map<string, { name: string; total: number; pay: number; cats: Record<string, number> }>();
    for (const e of filtered) {
      const g = m.get(e.worker_email) ?? { name: e.worker_name ?? e.worker_email, total: 0, pay: 0, cats: {} };
      g.total += e.hours;
      g.pay += entryPay(e);
      g.cats[e.category] = (g.cats[e.category] ?? 0) + e.hours;
      m.set(e.worker_email, g);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [filtered]);

  const total = useMemo(() => filtered.reduce((s, e) => s + e.hours, 0), [filtered]);
  const worked = byCategory.get("work")?.hours ?? 0;
  const pto = byCategory.get("pto")?.hours ?? 0;
  const workedPay = useMemo(() => filtered.reduce((s, e) => s + entryPay(e), 0), [filtered]);

  function exportCsv() {
    const header = [
      "Date",
      ...(isAdmin ? ["Contractor"] : []),
      "Category",
      "Start",
      "End",
      "Hours",
      "Rate",
      "Amount",
      "Status",
      "Note",
    ];
    const rows = [...filtered]
      .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : a.start_time.localeCompare(b.start_time)))
      .map((e) => [
        e.work_date,
        ...(isAdmin ? [e.worker_name ?? e.worker_email] : []),
        categoryLabel(e.category),
        e.start_time,
        e.end_time,
        fmtHours(e.hours),
        e.rate.toFixed(2),
        entryPay(e).toFixed(2),
        e.status,
        e.task,
      ]);
    downloadCsv(`atrs-report_${from}_to_${to}.csv`, [header, ...rows]);
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 text-base font-semibold">
          <BarChart3 className="h-4 w-4 text-brand" /> Reports
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => choosePreset(p.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  preset === p.key ? "bg-brand text-brand-fg" : "border border-line bg-surface text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted">From</label>
              <Input
                type="date"
                value={from}
                className="w-auto"
                onChange={(e) => {
                  setPreset("custom");
                  setFrom(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted">To</label>
              <Input
                type="date"
                value={to}
                className="w-auto"
                onChange={(e) => {
                  setPreset("custom");
                  setTo(e.target.value);
                }}
              />
            </div>
          </div>
          {isAdmin && workers.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted">Contractor</label>
              <Select value={worker} onChange={(e) => setWorker(e.target.value)} className="w-auto min-w-[150px]">
                <option value="all">All contractors</option>
                {workers.map(([email, name]) => (
                  <option key={email} value={email}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="ml-auto">
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted">
          {fmtDate(from)} – {fmtDate(to)} · {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </div>
      </Card>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Loading…</div>
      ) : (
        <>
          {/* Headline totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total hours" value={`${fmtHours(total)} h`} />
            <StatCard label="Worked" value={`${fmtHours(worked)} h`} />
            <StatCard label="PTO" value={`${fmtHours(pto)} h`} />
            <StatCard label="Worked pay" value={fmtMoney(workedPay)} strong />
          </div>
          <p className="text-xs text-muted">
            Pay = worked hours × each contractor's current rate (set in Team). Leave categories are tracked as hours only.
          </p>

          {/* By category */}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">By category</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Entries</th>
                  <th className="px-4 py-2 text-right font-medium">Hours</th>
                  <th className="px-4 py-2 text-right font-medium">Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {CATEGORIES.map((c) => {
                  const g = byCategory.get(c)!;
                  return (
                    <tr key={c} className={g.hours === 0 ? "text-muted" : ""}>
                      <td className="px-4 py-2.5">{CATEGORY_LABEL[c]}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{g.n}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtHours(g.hours)} h</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">{c === "work" ? fmtMoney(workedPay) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* By status */}
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">By status</div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {STATUS_ORDER.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="text-muted">{s.label}</span>
                  <span className="font-semibold tabular-nums">{fmtHours(byStatus.get(s.key) ?? 0)} h</span>
                </div>
              ))}
            </div>
          </Card>

          {/* By contractor (admin, all-contractor view) */}
          {isAdmin && worker === "all" && byWorker.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">By contractor</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="px-4 py-2 text-left font-medium">Contractor</th>
                      {CATEGORIES.map((c) => (
                        <th key={c} className="px-4 py-2 text-right font-medium">
                          {CATEGORY_LABEL[c]}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right font-medium">Total h</th>
                      <th className="px-4 py-2 text-right font-medium">Worked pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {byWorker.map(([email, g]) => (
                      <tr key={email}>
                        <td className="px-4 py-2.5 font-medium">{g.name}</td>
                        {CATEGORIES.map((c) => (
                          <td key={c} className="px-4 py-2.5 text-right tabular-nums text-muted">
                            {g.cats[c] ? fmtHours(g.cats[c]) : "—"}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtHours(g.total)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtMoney(g.pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Detail */}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">Detail</div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted">No time in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      {isAdmin && <th className="px-4 py-2 text-left font-medium">Contractor</th>}
                      <th className="px-4 py-2 text-left font-medium">Category</th>
                      <th className="px-4 py-2 text-left font-medium">Time</th>
                      <th className="px-4 py-2 text-right font-medium">Hours</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...filtered]
                      .sort((a, b) => (a.work_date < b.work_date ? 1 : a.work_date > b.work_date ? -1 : 0))
                      .map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(e.work_date)}</td>
                          {isAdmin && <td className="px-4 py-2.5">{e.worker_name ?? e.worker_email}</td>}
                          <td className="px-4 py-2.5">{CATEGORY_LABEL[e.category]}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                            {e.start_time}–{e.end_time}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtHours(e.hours)}</td>
                          <td className="px-4 py-2.5 capitalize text-muted">{e.status}</td>
                          <td className="max-w-[320px] px-4 py-2.5 text-ink/80">{e.task}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${strong ? "text-brand" : "text-ink"}`}>{value}</div>
    </Card>
  );
}

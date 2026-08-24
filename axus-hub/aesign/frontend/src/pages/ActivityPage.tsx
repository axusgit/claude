import { useEffect, useState } from "react";
import { Activity, RefreshCw, Search } from "lucide-react";
import { activityApi, type ActivityEntry } from "@/lib/api";
import { Card, Input } from "@/components/ui";

// Colour each action so the log scans quickly. Matched loosely by keyword.
function actionColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("delet")) return "bg-red-100 text-red-700";
  if (a.includes("declin") || a.includes("cancel") || a.includes("expire"))
    return "bg-amber-100 text-amber-700";
  if (a.includes("complet") || a.includes("sign")) return "bg-green-100 text-green-700";
  if (a.includes("sent") || a.includes("resent")) return "bg-blue-100 text-blue-700";
  if (a.includes("archiv") || a.includes("restor")) return "bg-slate-200 text-slate-700";
  return "bg-brand/10 text-brand"; // created / quote / other
}

export function ActivityPage() {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load(q = search) {
    setLoading(true);
    try {
      setRows(await activityApi.list(q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => void load(search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const when = (d: string) =>
    new Date(d).toLocaleString([], {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-sm text-muted">
          Every movement across the system — who did what, and when.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action or document…"
            className="pl-9"
          />
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium">No activity yet</p>
            <p className="text-sm text-muted">
              {search ? "Nothing matches your search." : "Actions across eSign will show up here."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Document</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{when(r.at)}</td>
                  <td className="px-4 py-3">{r.actor ?? "system"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${actionColor(r.action)}`}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Check, Users } from "lucide-react";
import { api, type Me, type Worker } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { confirmDialog } from "@/lib/confirm";
import { fmtHours, fmtMoney } from "@/lib/utils";

// Admin-only: manage contractors — set each person's pay rate ($/hour) and
// activate/deactivate them. History is always preserved.
export function TeamPage({ me: _me }: { me: Me }) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api.listWorkers();
      setWorkers(r.workers);
      setRateDraft(Object.fromEntries(r.workers.map((w) => [w.email, String(w.rate)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load team");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function saveRate(w: Worker) {
    const raw = rateDraft[w.email] ?? "";
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0) {
      setError("Enter a valid rate (0 or more).");
      return;
    }
    setBusy(w.email);
    setError(null);
    setNotice(null);
    try {
      await api.updateWorker(w.email, { rate });
      setNotice(`Rate for ${w.name} set to ${fmtMoney(rate)}/h.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rate");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(w: Worker) {
    const ok = await confirmDialog({
      title: w.active ? `Deactivate ${w.name}?` : `Reactivate ${w.name}?`,
      message: w.active
        ? "They won't be able to log new time. Their history is kept and still appears in reports."
        : "They'll be able to log time again.",
      confirmLabel: w.active ? "Deactivate" : "Reactivate",
      danger: w.active,
    });
    if (!ok) return;
    setBusy(w.email);
    try {
      await api.updateWorker(w.email, { active: !w.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {notice && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-base font-semibold">
          <Users className="h-4 w-4 text-brand" /> Team & pay rates
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">Loading…</div>
        ) : workers.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No one has signed in yet. A worker is added automatically on their first login.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-4 py-2 text-left font-medium">Contractor</th>
                  <th className="px-4 py-2 text-left font-medium">Rate ($/hour)</th>
                  <th className="px-4 py-2 text-right font-medium">Pending</th>
                  <th className="px-4 py-2 text-right font-medium">Approved (h)</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workers.map((w) => {
                  const changed = (rateDraft[w.email] ?? "") !== String(w.rate);
                  return (
                    <tr key={w.email} className={w.active ? "" : "opacity-60"}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{w.name}</div>
                        <div className="text-xs text-muted">{w.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={rateDraft[w.email] ?? ""}
                              onChange={(e) => setRateDraft({ ...rateDraft, [w.email]: e.target.value })}
                              className="w-28 pl-6"
                            />
                          </div>
                          {changed && (
                            <Button onClick={() => void saveRate(w)} disabled={busy === w.email} className="px-2.5 py-1.5">
                              <Check className="h-4 w-4" /> Save
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {w.pending_n > 0 ? (
                          <span className="font-semibold text-amber-600">{w.pending_n}</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtHours(w.approved_hours)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void toggleActive(w)}
                          disabled={busy === w.email}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            w.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {w.active ? "Active" : "Inactive"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-4 py-3 text-xs text-muted">
          Rates apply to reports and pay totals. Changing a rate affects how hours are valued going forward and in reports.
        </div>
      </Card>
    </div>
  );
}

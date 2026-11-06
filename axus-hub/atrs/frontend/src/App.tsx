import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { ConfirmHost } from "@/lib/confirm";
import { TimesheetPage } from "@/pages/TimesheetPage";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { TeamPage } from "@/pages/TeamPage";
import logo from "@/assets/axus-logo.png";

type View = "approvals" | "mine" | "reports" | "team";
const VIEW_KEY = "atrs:view";
const TAB_LABEL: Record<View, string> = { approvals: "Approvals", mine: "My time", reports: "Reports", team: "Team" };
const ALL_VIEWS: View[] = ["approvals", "mine", "reports", "team"];

function storedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return ALL_VIEWS.includes(v as View) ? (v as View) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(storedView);

  useEffect(() => {
    api.me().then(setMe, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  function chooseView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  const isAdmin = me?.role === "admin";
  // Tabs available to this role. Admins approve + can log their own time; both
  // roles can run reports. Contractors never see Approvals.
  const tabs: View[] = isAdmin ? ["approvals", "mine", "reports", "team"] : ["mine", "reports"];
  // Resolve the active view: stored preference if valid for the role, else the
  // role's default (Approvals for admins, My time for contractors).
  const activeView: View = view && tabs.includes(view) ? view : tabs[0];

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Axus Technologies" className="h-7 w-auto" />
            <span className="text-[13px] font-semibold text-muted">Time Reporting</span>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-medium" role="tablist" aria-label="View">
                {tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={activeView === t}
                    onClick={() => chooseView(t)}
                    className={`rounded-md px-3 py-1.5 transition ${
                      activeView === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
            {me && (
              <div className="text-right text-xs text-muted">
                <div className="font-medium text-ink">{me.name}</div>
                <div>{isAdmin ? "Approver" : "Contractor"}</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {!error && !me && <div className="py-20 text-center text-sm text-muted">Loading…</div>}
        {me && activeView === "approvals" && <ApprovalsPage me={me} />}
        {me && activeView === "mine" && <TimesheetPage me={me} />}
        {me && activeView === "reports" && <ReportsPage me={me} />}
        {me && activeView === "team" && <TeamPage me={me} />}
      </main>

      <ConfirmHost />
    </div>
  );
}

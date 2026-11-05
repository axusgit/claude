import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { ConfirmHost } from "@/lib/confirm";
import { TimesheetPage } from "@/pages/TimesheetPage";
import { ApprovalsPage } from "@/pages/ApprovalsPage";
import logo from "@/assets/axus-logo.png";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setMe, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Axus Technologies" className="h-7 w-auto" />
            <span className="text-[13px] font-semibold text-muted">Time Reporting</span>
          </div>
          {me && (
            <div className="text-right text-xs text-muted">
              <div className="font-medium text-ink">{me.name}</div>
              <div>{me.role === "admin" ? "Approver" : "Contractor"}</div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {!error && !me && <div className="py-20 text-center text-sm text-muted">Loading…</div>}
        {me && (me.role === "admin" ? <ApprovalsPage me={me} /> : <TimesheetPage me={me} />)}
      </main>

      <ConfirmHost />
    </div>
  );
}

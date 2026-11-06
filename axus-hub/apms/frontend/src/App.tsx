import { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { api, type Me } from "@/lib/api";
import { ConfirmHost, PromptHost } from "@/lib/confirm";
import { VaultProvider, useVault } from "@/lib/vault";
import { LockScreen } from "@/pages/LockScreen";
import { VaultPage } from "@/pages/VaultPage";
import { ImportPage } from "@/pages/ImportPage";
import { AdminPage } from "@/pages/AdminPage";
import logo from "@/assets/axus-logo.png";

type View = "vault" | "import" | "admin";
const VIEW_KEY = "apms:view";
const TAB_LABEL: Record<View, string> = { vault: "Vault", import: "Import", admin: "Admin" };

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setMe, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  if (error) {
    return (
      <div className="grid min-h-full place-items-center p-4">
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!me) return <div className="py-20 text-center text-sm text-muted">Loading…</div>;

  return (
    <VaultProvider isAdmin={me.role === "admin"}>
      <Shell me={me} />
      <ConfirmHost />
      <PromptHost />
    </VaultProvider>
  );
}

function Shell({ me }: { me: Me }) {
  const vault = useVault();
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as View | null;
      return v && ["vault", "import", "admin"].includes(v) ? v : "vault";
    } catch {
      return "vault";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  if (vault.status !== "unlocked") {
    return <LockScreen me={me} />;
  }

  const isAdmin = me.role === "admin";
  const tabs: View[] = isAdmin ? ["vault", "import", "admin"] : ["vault"];
  const active = tabs.includes(view) ? view : "vault";

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Axus Technologies" className="h-7 w-auto" />
            <span className="text-[13px] font-semibold text-muted">Password Management</span>
          </div>
          <div className="flex items-center gap-3">
            {tabs.length > 1 && (
              <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-medium" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={active === t}
                    onClick={() => setView(t)}
                    className={`rounded-md px-3 py-1.5 transition ${active === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
            <div className="hidden items-center gap-1.5 text-xs text-green-600 sm:flex" title="Zero-knowledge: unlocked in your browser only">
              <ShieldCheck className="h-4 w-4" /> Unlocked
            </div>
            <button
              onClick={vault.lock}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas"
              title="Lock the vault"
            >
              <Lock className="h-4 w-4" /> Lock
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {active === "vault" && <VaultPage />}
        {active === "import" && isAdmin && <ImportPage />}
        {active === "admin" && isAdmin && <AdminPage />}
      </main>
    </div>
  );
}

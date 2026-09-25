import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { LogOut, Moon, Sun } from "lucide-react";
import { EnvelopeList } from "@/pages/EnvelopeList";
import { EnvelopeEditor } from "@/pages/EnvelopeEditor";
import { ContactsPage } from "@/pages/ContactsPage";
import { CompaniesPage } from "@/pages/CompaniesPage";
import { QuoteBuilder } from "@/pages/QuoteBuilder";
import { QuickReferencePage } from "@/pages/QuickReferencePage";
import { ArchivePage } from "@/pages/ArchivePage";
import { RecycleBinPage } from "@/pages/RecycleBinPage";
import { ActivityPage } from "@/pages/ActivityPage";
import { SignPage } from "@/pages/SignPage";

const navCls = ({ isActive }: { isActive: boolean }) =>
  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
  (isActive ? "bg-brand/10 text-brand" : "text-muted hover:text-ink");

function useTheme() {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute("data-theme") || "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("aesign-theme", theme);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export function App() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  // The signer experience is a standalone full-page flow (no staff chrome).
  const isSigning = pathname.startsWith("/sign/");
  if (isSigning) {
    return (
      <Routes>
        <Route path="/sign/:token" element={<SignPage />} />
      </Routes>
    );
  }
  return (
    <div className="min-h-full">
      <header className="esign-topbar">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/assets/axus-logo.png" alt="Axus Technologies" className="h-8 w-auto" />
            <span className="brand-gradient text-[15px] font-semibold">eSign</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navCls}>
              Documents
            </NavLink>
            <NavLink to="/companies" className={navCls}>
              Companies
            </NavLink>
            <NavLink to="/contacts" className={navCls}>
              Contacts
            </NavLink>
            <NavLink to="/reference" className={navCls}>
              Quick reference
            </NavLink>
            <NavLink to="/archive" className={navCls}>
              Archive
            </NavLink>
            <NavLink to="/recycle" className={navCls}>
              Recycle Bin
            </NavLink>
            <NavLink to="/activity" className={navCls}>
              Activity
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggle}
              title="Toggle dark / light"
              aria-label="Toggle dark / light"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:text-ink"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <a
              href="/outpost.goauthentik.io/sign_out"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" /> Log out
            </a>
          </div>
        </div>
        <div className="accent-strip h-0.5" />
      </header>
      <main key={pathname} className="view-in mx-auto max-w-6xl px-5 py-6">
        <Routes>
          <Route path="/" element={<EnvelopeList />} />
          <Route path="/envelopes/:id" element={<EnvelopeEditor />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/quotes/new" element={<QuoteBuilder />} />
          <Route path="/reference" element={<QuickReferencePage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/recycle" element={<RecycleBinPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Routes>
      </main>
    </div>
  );
}

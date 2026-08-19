import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Scale } from "lucide-react";
import { EnvelopeList } from "@/pages/EnvelopeList";
import { EnvelopeEditor } from "@/pages/EnvelopeEditor";
import { ContactsPage } from "@/pages/ContactsPage";
import { SignPage } from "@/pages/SignPage";

const navCls = ({ isActive }: { isActive: boolean }) =>
  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
  (isActive ? "bg-brand/10 text-brand" : "text-muted hover:text-ink");

export function App() {
  // The signer experience is a standalone full-page flow (no staff chrome).
  const isSigning = useLocation().pathname.startsWith("/sign/");
  if (isSigning) {
    return (
      <Routes>
        <Route path="/sign/:token" element={<SignPage />} />
      </Routes>
    );
  }
  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-fg">
              <Scale className="h-4.5 w-4.5" />
            </span>
            <span className="text-[15px] font-semibold">
              Axus <span className="text-muted">Legal</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navCls}>
              Documents
            </NavLink>
            <NavLink to="/contacts" className={navCls}>
              Contacts
            </NavLink>
          </nav>
        </div>
        <div className="h-0.5 bg-brand" />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">
        <Routes>
          <Route path="/" element={<EnvelopeList />} />
          <Route path="/envelopes/:id" element={<EnvelopeEditor />} />
          <Route path="/contacts" element={<ContactsPage />} />
        </Routes>
      </main>
    </div>
  );
}

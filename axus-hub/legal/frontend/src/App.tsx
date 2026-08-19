import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Scale } from "lucide-react";
import { EnvelopeList } from "@/pages/EnvelopeList";
import { EnvelopeEditor } from "@/pages/EnvelopeEditor";
import { SignPage } from "@/pages/SignPage";

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
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-fg">
              <Scale className="h-4.5 w-4.5" />
            </span>
            <span className="text-[15px] font-semibold">
              Axus <span className="text-muted">Legal</span>
            </span>
          </Link>
        </div>
        <div className="h-0.5 bg-brand" />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">
        <Routes>
          <Route path="/" element={<EnvelopeList />} />
          <Route path="/envelopes/:id" element={<EnvelopeEditor />} />
        </Routes>
      </main>
    </div>
  );
}

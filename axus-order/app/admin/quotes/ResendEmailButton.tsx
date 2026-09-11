"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin: (re)send the quote email to Axus sales (+ customer CC). Uses the same endpoint
// as the public "Talk to Axus" button; the server records the delivery outcome.
export function ResendEmailButton({
  quoteId,
  status,
}: {
  quoteId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<null | "ok" | "err">(null);

  const label = status === "failed" ? "Retry" : status === "sent" ? "Resend" : "Send";

  async function send() {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/email`, { method: "POST" });
      if (!res.ok) throw new Error();
      setFlash("ok");
      router.refresh();
    } catch {
      setFlash("err");
    } finally {
      setBusy(false);
      setTimeout(() => setFlash(null), 2500);
    }
  }

  return (
    <button
      onClick={send}
      disabled={busy}
      title="Email this quote to Axus sales (and CC the customer)"
      className={
        "rounded-md border px-2.5 py-1 text-xs transition-all disabled:opacity-50 " +
        (flash === "ok"
          ? "border-ok text-ok"
          : flash === "err"
            ? "border-warn text-warn"
            : "border-line text-muted hover:border-accent hover:text-accent")
      }
    >
      {busy ? "…" : flash === "ok" ? "Sent ✓" : flash === "err" ? "Failed" : label}
    </button>
  );
}

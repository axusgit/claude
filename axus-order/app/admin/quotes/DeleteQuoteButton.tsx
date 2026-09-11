"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin-only: delete a test/unused quote from the quotes list.
export function DeleteQuoteButton({ quoteId, label }: { quoteId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm(`Delete quote ${label ?? quoteId}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/admin/quotes/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      title="Delete quote"
      className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-all hover:border-warn hover:text-warn disabled:opacity-50"
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Removes one line from a saved quote (quote screen). Confirms first, then
// refreshes so the subtotal updates.
export function RemoveLineButton({ quoteId, lineId }: { quoteId: string; lineId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm("Remove this item from the quote?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/remove-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      aria-label="Remove item"
      title="Remove item from quote"
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-sm text-muted transition-all hover:border-warn hover:text-warn disabled:opacity-50"
    >
      {busy ? "…" : "✕"}
    </button>
  );
}

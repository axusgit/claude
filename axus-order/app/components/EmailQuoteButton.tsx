"use client";

import { useState } from "react";

// "Talk to Axus about this quote" — emails the quote (PDF attached) to Axus sales.
export function EmailQuoteButton({ quoteId }: { quoteId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setMsg(null);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/email`, { method: "POST" });
      let data: { ok?: boolean; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Could not send the email.");
      setState("sent");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  if (state === "sent") {
    return (
      <span className="inline-flex items-center rounded-lg border border-ok/40 bg-ok/10 px-4 py-2 text-sm font-medium text-ok">
        ✓ Sent to Axus — we&rsquo;ll be in touch
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        onClick={send}
        disabled={state === "sending"}
        className="rounded-lg border border-line bg-white/[0.02] px-4 py-2 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Talk to Axus about this quote"}
      </button>
      {state === "error" && msg && <span className="text-xs text-warn">{msg}</span>}
    </span>
  );
}

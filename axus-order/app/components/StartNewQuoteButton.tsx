"use client";

import { useRouter } from "next/navigation";

// Clears the current cart / accepted alternatives and resets the disclaimer
// acceptance (so the legal message is shown again), then returns to the catalog
// for a fresh quote. Customer details are kept so they aren't re-typed.
export function StartNewQuoteButton({ className }: { className?: string }) {
  const router = useRouter();
  function start() {
    try {
      localStorage.removeItem("axus-order-cart");
      localStorage.removeItem("axus-order-replacements");
      localStorage.removeItem("axus-order-disclaimer-accepted");
    } catch {
      /* ignore */
    }
    router.push("/");
  }
  return (
    <button
      onClick={start}
      className={
        className ??
        "btn-accent rounded-lg px-4 py-2 text-sm font-semibold"
      }
    >
      Start New Quote
    </button>
  );
}

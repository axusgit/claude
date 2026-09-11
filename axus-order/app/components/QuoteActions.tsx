"use client";

import Link from "next/link";
import { useState } from "react";
import { StartNewQuoteButton } from "./StartNewQuoteButton";
import { EmailQuoteButton } from "./EmailQuoteButton";

const outlineBtn =
  "rounded-lg border border-line bg-white/[0.02] px-4 py-2 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent";

// All quote actions in one place: an accept checkbox that gates Download/Print,
// with every action button combined on one row beneath it. In admin review mode
// (an admin opened the quote from the admin list) the accept gate is skipped.
export function QuoteActions({
  quoteId,
  adminReview = false,
}: {
  quoteId: string;
  adminReview?: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  const canPrint = adminReview || accepted;
  return (
    <div className="no-print mt-8">
      {!adminReview && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="h-4 w-4 accent-[#ff7a3d]"
          />
          <span>I have read and accept the terms above to download or print this quote.</span>
        </label>
      )}

      <div className={(adminReview ? "" : "mt-3 ") + "flex flex-wrap items-center gap-3"}>
        <button
          onClick={() => window.print()}
          disabled={!canPrint}
          title={canPrint ? "" : "Please accept the terms first"}
          className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download / Print PDF
        </button>
        <Link href="/" className={outlineBtn}>
          Continue shopping
        </Link>
        <StartNewQuoteButton className={outlineBtn} />
        <EmailQuoteButton quoteId={quoteId} />
      </div>
    </div>
  );
}

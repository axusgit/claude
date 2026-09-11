"use client";

import { useState } from "react";

// The customer must accept the terms above before downloading / printing the quote.
export function AcceptToPrint() {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="h-4 w-4 accent-[#ff7a3d]"
        />
        <span>
          I have read and accept the terms above to download or print this quote.
        </span>
      </label>
      <button
        onClick={() => window.print()}
        disabled={!accepted}
        title={accepted ? "" : "Please accept the terms first"}
        className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        Download / Print PDF
      </button>
    </div>
  );
}

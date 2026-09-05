"use client";

// Client-side "Download PDF" — uses the browser's print-to-PDF. The quote page has
// print styles that render a clean light-on-white document.
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold"
    >
      Download / Print PDF
    </button>
  );
}

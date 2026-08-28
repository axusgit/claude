// A human-friendly file/display name for an envelope, used when a document is
// downloaded or emailed. Quotes are named "Quote <number>"; other documents use
// their title, falling back to "<Type> - <Company>" (or "Document") when unnamed.
export interface NamedEnvelope {
  doc_type?: string | null;
  title?: string | null;
  company?: string | null;
  quote_data?: { quote_number?: string } | null;
}

// Strip characters that are illegal in file names / Content-Disposition.
function clean(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

export function envelopeDocName(env: NamedEnvelope): string {
  if ((env.doc_type ?? "").trim() === "Quote") {
    const num = (env.quote_data?.quote_number ?? "").trim();
    return clean(num ? `Quote ${num}` : "Quote");
  }
  const title = (env.title ?? "").trim();
  if (title && title.toLowerCase() !== "untitled document") return clean(title);
  // Document without a name — build one the same way, from type + company.
  const parts = [env.doc_type, env.company].map((s) => (s ?? "").trim()).filter(Boolean);
  return clean(parts.join(" - ")) || "Document";
}

// A human-friendly file/display name for an envelope, used when a document is
// downloaded or emailed. Uniform format is "<Type> - <Title>", e.g.
// "Quote - HCN 9-11-2026". The title falls back to the company, then (for quotes)
// the quote number; when a title already starts with the type we don't repeat it.
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
  const type = (env.doc_type ?? "").trim();
  // Best "title" part: the envelope title, else the company, else (quotes) the quote number.
  const rawTitle = (env.title ?? "").trim();
  let title = rawTitle && rawTitle.toLowerCase() !== "untitled document" ? rawTitle : "";
  if (!title) title = (env.company ?? "").trim();
  if (!title && type === "Quote") title = (env.quote_data?.quote_number ?? "").trim();

  if (!type) return clean(title) || "Document";
  if (!title) return clean(type);
  // "Type - Title", but don't double the type if the title already leads with it.
  if (title.toLowerCase().startsWith(type.toLowerCase())) return clean(title);
  return clean(`${type} - ${title}`);
}

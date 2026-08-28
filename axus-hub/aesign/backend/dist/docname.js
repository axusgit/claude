// Strip characters that are illegal in file names / Content-Disposition.
function clean(s) {
    return s
        .replace(/[\\/:*?"<>|\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
}
export function envelopeDocName(env) {
    if ((env.doc_type ?? "").trim() === "Quote") {
        const num = (env.quote_data?.quote_number ?? "").trim();
        return clean(num ? `Quote ${num}` : "Quote");
    }
    const title = (env.title ?? "").trim();
    if (title && title.toLowerCase() !== "untitled document")
        return clean(title);
    // Document without a name — build one the same way, from type + company.
    const parts = [env.doc_type, env.company].map((s) => (s ?? "").trim()).filter(Boolean);
    return clean(parts.join(" - ")) || "Document";
}
//# sourceMappingURL=docname.js.map
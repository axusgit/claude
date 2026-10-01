// Strip characters that are illegal in file names / Content-Disposition. The
// Content-Disposition header must be ASCII, so normalize dashes and drop any
// remaining non-ASCII (e.g. an em dash in a title would otherwise 500 the
// document download with ERR_INVALID_CHAR).
function clean(s) {
    return s
        .replace(/[‐-―]/g, "-") // hyphen/figure/en/em dashes → ASCII hyphen
        .replace(/[^\x20-\x7E]/g, "") // drop remaining non-ASCII
        .replace(/[\\/:*?"<>|\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
}
export function envelopeDocName(env) {
    const type = (env.doc_type ?? "").trim();
    // Best "title" part: the envelope title, else the company, else (quotes) the quote number.
    const rawTitle = (env.title ?? "").trim();
    let title = rawTitle && rawTitle.toLowerCase() !== "untitled document" ? rawTitle : "";
    if (!title)
        title = (env.company ?? "").trim();
    if (!title && type === "Quote")
        title = (env.quote_data?.quote_number ?? "").trim();
    if (!type)
        return clean(title) || "Document";
    if (!title)
        return clean(type);
    // "Type - Title", but don't double the type if the title already leads with it.
    if (title.toLowerCase().startsWith(type.toLowerCase()))
        return clean(title);
    return clean(`${type} - ${title}`);
}
//# sourceMappingURL=docname.js.map
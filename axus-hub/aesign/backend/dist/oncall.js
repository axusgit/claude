// Best-effort notification back to the On Call system when one of ITS quotes is
// signed/completed in eSign. On Call creates these via /api/external/quotes
// (created_by = oncall@…, doc_type = 'Quote'); when the customer finishes
// signing, we POST the signed quote (total + sealed PDF) so it can be shown
// under On Call's Invoices. Reuses the shared EXTERNAL_API_TOKEN as the bearer.
// Never throws — a callback failure must not affect the signer's completion.
import { config } from "./config.js";
// Mirrors quotepdf.ts total math: line = qty*(unit_price - discount), plus tax
// unless EXEMPT. Returns cents.
export function quoteTotalCents(quote) {
    const items = quote?.items ?? [];
    let subtotal = 0;
    for (const it of items) {
        subtotal += (Number(it.qty) || 0) * ((Number(it.unit_price) || 0) - (Number(it.discount) || 0));
    }
    const taxExempt = !quote?.tax || /exempt/i.test(String(quote?.tax));
    const taxAmt = taxExempt ? 0 : Number(quote?.tax) || 0;
    return Math.round((subtotal + taxAmt) * 100);
}
export function isOnCallQuote(e) {
    return e.doc_type === "Quote" && e.created_by === "oncall@axustechnologies.com";
}
export async function notifyOnCallQuoteCompleted(e, sealedBytes, sha256, signers) {
    if (!config.onCallCallbackUrl || !config.externalToken)
        return;
    try {
        const signer = signers[0];
        const payload = {
            envelopeId: e.id,
            quoteNumber: e.quote_data?.quote_number ?? null,
            company: e.company ?? e.quote_data?.customer?.company ?? null,
            totalCents: quoteTotalCents(e.quote_data),
            status: "completed",
            sha256,
            signedAt: signer?.signed_at ?? null,
            signer: signer ? { name: signer.name, email: signer.email } : null,
            pdfBase64: Buffer.from(sealedBytes).toString("base64"),
        };
        const res = await fetch(config.onCallCallbackUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${config.externalToken}`,
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok)
            console.error(`[oncall] completion callback failed: HTTP ${res.status}`);
    }
    catch (err) {
        console.error(`[oncall] completion callback error: ${err.message}`);
    }
}
//# sourceMappingURL=oncall.js.map
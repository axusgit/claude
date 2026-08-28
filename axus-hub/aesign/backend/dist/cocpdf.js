// Axus Certificate of Completion (project close-out) — ONE-PAGE template,
// generated on the Axus letterhead. Condensed from the real Premier Community
// HealthCare form. TWO signers: the Customer (recipient 1) and Axus Technologies
// (recipient 2); their signature blocks sit SIDE BY SIDE at the bottom at FIXED
// positions, so the frontend hardcodes a matching COC_LAYOUT (see EnvelopeEditor).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const ORANGE = rgb(0.92, 0.35, 0.05);
const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.42, 0.45, 0.5);
const W = 612;
const H = 792;
const M = 56;
const TOP_SAFE = 150; // below the letterhead logo band
export async function generateCocPdf(d = {}, opts = {}) {
    const assetsDir = opts.assetsDir ?? join(process.cwd(), "assets");
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let letter = null;
    try {
        letter = await pdf.embedJpg(await readFile(join(assetsDir, "letterhead.jpg")));
    }
    catch {
        /* letterhead optional */
    }
    const page = pdf.addPage([W, H]);
    if (letter)
        page.drawImage(letter, { x: 0, y: 0, width: W, height: H });
    const T = (topY) => H - topY;
    const wrap = (raw, font, size, maxW) => {
        const words = String(raw ?? "").split(/\s+/);
        const lines = [];
        let cur = "";
        for (const w of words) {
            const t = cur ? `${cur} ${w}` : w;
            if (font.widthOfTextAtSize(t, size) > maxW && cur) {
                lines.push(cur);
                cur = w;
            }
            else
                cur = t;
        }
        if (cur)
            lines.push(cur);
        return lines.length ? lines : [""];
    };
    const company = d.company?.trim() || "the Customer";
    // ---- Heading + date ----
    page.drawText("Certificate of Completion", { x: M, y: T(TOP_SAFE + 8), size: 18, font: bold, color: rgb(0.09, 0.11, 0.15) });
    page.drawText(d.dateLong || "", { x: M, y: T(TOP_SAFE + 26), size: 9.5, font: helv, color: MUTED });
    // ---- Condensed body ----
    let y = TOP_SAFE + 48;
    const SZ = 9.4;
    const LEAD = SZ + 3;
    const para = (text, o = {}) => {
        const indent = o.indent ?? 0;
        for (const ln of wrap(text, helv, SZ, W - 2 * M - indent)) {
            page.drawText(ln, { x: M + indent, y: T(y), size: SZ, font: helv, color: INK });
            y += o.lead ?? LEAD;
        }
        y += o.after ?? 5;
    };
    // Document Number is entered by Axus staff and BAKED into the document (never a
    // signer field — the Customer must never fill or edit it). Required before send.
    const docNo = d.docNumber?.trim() || "________________";
    para(`This Certificate of Completion (the "Certificate") certifies that Axus Technologies (the "Provider") has completed the project (the "Project") performed for ${company} (the "Customer") under the Proposal Agreement bearing Document Number: ${docNo} (the "Agreement"), together with any duly executed change orders (the "Change Orders").`, { after: 6 });
    para(`By signing below, the Customer certifies, represents, and warrants that:`, { after: 6 });
    const points = [
        "The Provider has fully and satisfactorily performed and completed all obligations, deliverables, milestones, and services under the Agreement and any Change Orders, in accordance with the specifications, timelines, and quality standards specified therein;",
        "The Customer has inspected, tested, and accepted all such deliverables and services, and no material defects, deficiencies, or outstanding issues remain unresolved as of the date of execution;",
        "The Project is complete in its entirety, and the Customer releases the Provider from any further performance obligations under the Agreement and Change Orders, subject to any surviving warranties, indemnities, or post-completion obligations expressly provided therein; and",
        "Any additional work, modifications, or services beyond the scope of the Agreement and Change Orders must be negotiated and formalized through a separate, new proposal agreement executed by both parties.",
    ];
    points.forEach((p, i) => {
        page.drawText(`(${"abcd"[i]})`, { x: M, y: T(y), size: SZ, font: bold, color: ORANGE });
        para(p, { indent: 22, after: 5 });
    });
    para("This Certificate is governed by the laws specified in the Agreement and constitutes a binding and enforceable agreement. The Customer acknowledges that it has had the opportunity to review this Certificate and to seek independent legal advice.", { after: 4 });
    // ================= SIGNATURES (side by side, fixed positions) =================
    const sigTop = 566; // fixed top of the signature area
    page.drawText("Executed by the parties as of the date written below.", { x: M, y: T(sigTop - 16), size: 9.5, font: helv, color: MUTED });
    const colW = 236;
    const leftX = M; // 56
    const rightX = M + colW + 28; // 320
    const wAt = (s) => helv.widthOfTextAtSize(s, 10);
    // One signature block (heading + 4 labelled underlines). Returns the signer slot.
    const block = (role, heading, x0) => {
        const xEnd = x0 + colW;
        page.drawText(heading, { x: x0, y: T(sigTop), size: 10.5, font: bold, color: rgb(0.09, 0.11, 0.15) });
        const rows = [
            { label: "Signature:", type: "signature" },
            { label: "Print Name:", type: "name" },
            { label: "Title:", type: "title" },
            { label: "Date:", type: "date" },
        ];
        const fields = [];
        let ry = sigTop + 26;
        for (const r of rows) {
            page.drawText(r.label, { x: x0, y: T(ry), size: 10, font: helv, color: INK });
            const fx = x0 + wAt(r.label) + 6;
            page.drawLine({ start: { x: fx, y: T(ry) - 2 }, end: { x: xEnd, y: T(ry) - 2 }, thickness: 0.6, color: rgb(0.55, 0.57, 0.6) });
            fields.push({
                type: r.type,
                page: 1,
                x: +(fx / W).toFixed(4),
                y: +((ry - 12) / H).toFixed(4),
                w: +((xEnd - fx) / W).toFixed(4),
                h: +(15 / H).toFixed(4),
            });
            ry += 22;
        }
        return { role, fields };
    };
    const customerSlot = block("Customer", company === "the Customer" ? "Customer" : company, leftX);
    const axusSlot = block("Axus Technologies", "Axus Technologies", rightX);
    page.drawText("Thank you for considering Axus for your IT needs.", { x: M, y: T(sigTop + 128), size: 10.5, font: bold, color: ORANGE });
    const layout = [customerSlot, axusSlot];
    return { bytes: await pdf.save(), layout };
}
//# sourceMappingURL=cocpdf.js.map
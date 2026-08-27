// Axus Certificate of Completion (a.k.a. "Project Completion Certification Form")
// — project close-out template, generated on the Axus letterhead. Based on the
// real Premier Community HealthCare form. TWO signers: the Customer (recipient 1)
// and Axus Technologies (recipient 2); each signature block is auto-anchored by
// the e-sign editor. The signature blocks sit on their own final page at FIXED
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
const BOT_SAFE = 700; // above the letterhead footer
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
    const T = (topY) => H - topY;
    const drawBg = (pg) => {
        if (letter)
            pg.drawImage(letter, { x: 0, y: 0, width: W, height: H });
    };
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
    const docNo = d.docNumber?.trim() || "____________________________";
    // ---- Flowing body with letterhead-aware pagination ----
    let page = pdf.addPage([W, H]);
    drawBg(page);
    let y = TOP_SAFE; // baseline distance from top
    const ensure = (space) => {
        if (y + space > BOT_SAFE) {
            page = pdf.addPage([W, H]);
            drawBg(page);
            y = TOP_SAFE;
        }
    };
    const para = (text, o = {}) => {
        const size = o.size ?? 9.8;
        const font = o.font ?? helv;
        const lead = o.lead ?? size + 3.4;
        const indent = o.indent ?? 0;
        for (const ln of wrap(text, font, size, W - 2 * M - indent)) {
            ensure(lead);
            page.drawText(ln, { x: M + indent, y: T(y), size, font, color: o.color ?? INK });
            y += lead;
        }
        y += o.after ?? 6;
    };
    // Heading + date
    page.drawText("Certificate of Completion", { x: M, y: T(y + 8), size: 20, font: bold, color: rgb(0.09, 0.11, 0.15) });
    y += 30;
    page.drawText(d.dateLong || "", { x: M, y: T(y), size: 10, font: helv, color: MUTED });
    y += 22;
    para(`This Project Completion Certification Form (the "Form") serves as formal acknowledgment and certification regarding the completion of the aforementioned project (the "Project") undertaken by Axus Technologies (the "Provider") pursuant to the terms and conditions set forth in the original Proposal Agreement bearing Document Number: ${docNo} (the "Agreement"), as may have been amended or supplemented by any duly executed change orders (collectively, the "Change Orders").`, { after: 8 });
    para(`By signing this Form, you, representing ${company} (the "Customer"), certify, represent, and warrant the following:`, { after: 8 });
    const points = [
        "That the Provider has fully and satisfactorily performed, delivered, and completed all obligations, deliverables, milestones, and services outlined in the Agreement and any applicable Change Orders, in accordance with the specifications, timelines, and quality standards therein specified;",
        "That the Customer has inspected, tested, and accepted all such deliverables and services, and that no material defects, deficiencies, or outstanding issues remain unresolved as of the date of execution hereof;",
        "That the Project is deemed complete in its entirety, and the Customer hereby releases the Provider from any further performance obligations under the Agreement and Change Orders, subject to any surviving warranties, indemnities, or post-completion obligations expressly provided therein;",
        "That any requests for additional work, modifications, enhancements, or services beyond the scope of the Agreement and Change Orders, whether arising subsequent to the execution of this Form or otherwise, shall not be considered part of the Project and must be negotiated and formalized through a separate, new proposal agreement executed by both parties.",
    ];
    points.forEach((p, i) => {
        ensure(9.8 + 3.4);
        page.drawText(`(${"abcd"[i]})`, { x: M, y: T(y), size: 9.8, font: bold, color: ORANGE });
        para(p, { indent: 24, after: 7 });
    });
    para("This Form shall be governed by the laws of the jurisdiction specified in the Agreement, without regard to conflict of laws principles. Execution of this Form constitutes a binding and enforceable agreement, and the Customer acknowledges that it has had the opportunity to review this Form and seek independent legal advice if desired.", { after: 4 });
    // ================= SIGNATURES (own final page; two signers) =================
    const sig = pdf.addPage([W, H]);
    drawBg(sig);
    const sigPage = pdf.getPageCount(); // 1-based number of the signature page
    const putS = (s, x, topY, o = {}) => sig.drawText(String(s ?? ""), { x, y: T(topY), size: o.size ?? 11, font: o.bold ? bold : helv, color: o.color ?? INK });
    const SIG_LINE = "Signature: ______________________________";
    const NAME_LINE = "Print Name: ______________________________";
    const TITLE_LINE = "Title: ______________________________";
    const DATE_LINE = "Date: ______________________________";
    const wAt = (s) => helv.widthOfTextAtSize(s, 11);
    const rect = (type, label, full, baseY) => {
        const x0 = M + wAt(label);
        const x1 = M + wAt(full);
        return {
            type,
            page: sigPage,
            x: +(x0 / W).toFixed(4),
            y: +((baseY - 15) / H).toFixed(4),
            w: +((x1 - x0) / W).toFixed(4),
            h: +(17 / H).toFixed(4),
        };
    };
    // A signature block: heading + 4 underscore lines. Returns the signer-field slot.
    const block = (role, heading, topY) => {
        putS(heading, M, topY, { size: 11, bold: true, color: rgb(0.09, 0.11, 0.15) });
        const sy = topY + 26;
        const ny = sy + 26;
        const ty = ny + 26;
        const dy = ty + 26;
        putS(SIG_LINE, M, sy);
        putS(NAME_LINE, M, ny);
        putS(TITLE_LINE, M, ty);
        putS(DATE_LINE, M, dy);
        return {
            role,
            fields: [
                rect("signature", "Signature: ", SIG_LINE, sy),
                rect("name", "Print Name: ", NAME_LINE, ny),
                rect("title", "Title: ", TITLE_LINE, ty),
                rect("date", "Date: ", DATE_LINE, dy),
            ],
        };
    };
    putS("The parties have executed this Form as of the date written below.", M, TOP_SAFE, { size: 10, bold: false, color: MUTED });
    const customerSlot = block("Customer", company === "the Customer" ? "Customer" : company, TOP_SAFE + 34);
    const axusSlot = block("Axus Technologies", "Axus Technologies", TOP_SAFE + 190);
    putS("Thank you for considering Axus for your IT needs.", M, TOP_SAFE + 350, { size: 11, bold: true, color: ORANGE });
    const layout = [customerSlot, axusSlot];
    return { bytes: await pdf.save(), layout };
}
//# sourceMappingURL=cocpdf.js.map
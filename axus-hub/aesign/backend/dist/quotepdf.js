import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const ORANGE = rgb(0.92, 0.35, 0.05);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.85, 0.86, 0.88);
const HEADBG = rgb(0.96, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);
const W = 612;
const H = 792;
const M = 54;
function money(n) {
    return "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export async function generateQuotePdf(d) {
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let logo = null;
    try {
        logo = await pdf.embedPng(await readFile(join(process.cwd(), "assets", "axus-logo.png")));
    }
    catch {
        /* logo optional */
    }
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
    const put = (page, s, x, topY, o = {}) => page.drawText(String(s ?? ""), { x, y: T(topY), size: o.size ?? 9, font: o.bold ? bold : helv, color: o.color ?? INK });
    // ================= PAGE 1 =================
    const p1 = pdf.addPage([W, H]);
    if (logo) {
        const lw = 112;
        const lh = (lw * 125) / 238;
        p1.drawImage(logo, { x: M, y: T(42) - lh, width: lw, height: lh });
    }
    put(p1, "QUOTE", 430, 60, { size: 24, bold: true });
    put(p1, `# ${d.quote_number}`, 430, 78, { size: 10, color: MUTED });
    put(p1, `Date: ${d.quote_date}`, 430, 92, { size: 10, color: MUTED });
    let ay = 116;
    put(p1, "Axus Technologies", M, ay, { size: 10, bold: true });
    ay += 13;
    for (const l of ["13046 Racetrack RD., Suite 255", "Tampa, FL 33626", "Phone 813-922-2323", "sales@axustechnologies.com"]) {
        put(p1, l, M, ay, { size: 9, color: MUTED });
        ay += 12;
    }
    const tox = 330;
    let toy = 108;
    put(p1, "QUOTE TO", tox, toy, { size: 8, bold: true, color: ORANGE });
    toy += 14;
    const toLines = [
        d.customer.contact,
        d.customer.company,
        ...String(d.customer.address ?? "").split("\n"),
        d.customer.phone ? `Phone: ${d.customer.phone}` : "",
    ]
        .map((s) => (s ?? "").trim())
        .filter(Boolean);
    for (const l of toLines) {
        put(p1, l, tox, toy, { size: 9.5 });
        toy += 12;
    }
    // Details strip
    const stripTop = 205;
    const stripH = 34;
    const cols = [
        { h: "SALESPERSON", v: d.salesperson },
        { h: "JOB", v: d.job },
        { h: "SHIPPING", v: d.shipping_method },
        { h: "DELIVERY", v: d.delivery_date },
        { h: "PAYMENT TERMS", v: d.payment_terms },
        { h: "DUE DATE", v: d.due_date },
    ];
    const colW = (W - 2 * M) / cols.length;
    p1.drawRectangle({ x: M, y: T(stripTop + stripH), width: W - 2 * M, height: stripH, color: HEADBG, borderColor: LINE, borderWidth: 0.5 });
    cols.forEach((c, i) => {
        const cx = M + i * colW + 5;
        put(p1, c.h, cx, stripTop + 12, { size: 6, bold: true, color: MUTED });
        put(p1, c.v || "—", cx, stripTop + 26, { size: 8.5 });
        if (i > 0)
            p1.drawLine({ start: { x: M + i * colW, y: T(stripTop) }, end: { x: M + i * colW, y: T(stripTop + stripH) }, color: LINE, thickness: 0.5 });
    });
    // Line items
    const cx = { qty: M + 4, item: M + 46, desc: M + 150, unit: 398, disc: 458, total: 508 };
    let ty = stripTop + stripH + 24;
    p1.drawRectangle({ x: M, y: T(ty + 4), width: W - 2 * M, height: 18, color: ORANGE });
    put(p1, "QTY", cx.qty, ty, { size: 7.5, bold: true, color: WHITE });
    put(p1, "ITEM #", cx.item, ty, { size: 7.5, bold: true, color: WHITE });
    put(p1, "DESCRIPTION", cx.desc, ty, { size: 7.5, bold: true, color: WHITE });
    put(p1, "UNIT PRICE", cx.unit, ty, { size: 7.5, bold: true, color: WHITE });
    put(p1, "DISC.", cx.disc, ty, { size: 7.5, bold: true, color: WHITE });
    put(p1, "LINE TOTAL", cx.total, ty, { size: 7.5, bold: true, color: WHITE });
    ty += 14;
    let subtotal = 0;
    let totalDisc = 0;
    for (const it of d.items) {
        const qty = Number(it.qty) || 0;
        const unit = Number(it.unit_price) || 0;
        const disc = Number(it.discount) || 0;
        const lineTotal = qty * unit - disc;
        subtotal += lineTotal;
        totalDisc += disc;
        const descLines = wrap(it.description, helv, 8.5, cx.unit - cx.desc - 8);
        const rowH = Math.max(15, descLines.length * 10.5 + 5);
        put(p1, String(qty), cx.qty, ty + 11, { size: 8.5 });
        put(p1, it.item, cx.item, ty + 11, { size: 8.5 });
        descLines.forEach((dl, i) => put(p1, dl, cx.desc, ty + 11 + i * 10.5, { size: 8.5 }));
        put(p1, money(unit), cx.unit, ty + 11, { size: 8.5 });
        put(p1, disc ? money(disc) : "", cx.disc, ty + 11, { size: 8.5 });
        put(p1, money(lineTotal), cx.total, ty + 11, { size: 8.5 });
        ty += rowH;
        p1.drawLine({ start: { x: M, y: T(ty) }, end: { x: W - M, y: T(ty) }, color: LINE, thickness: 0.4 });
        if (ty > 660)
            break; // v1: items fit on one page
    }
    // Totals
    const taxExempt = !d.tax || /exempt/i.test(d.tax);
    const taxAmt = taxExempt ? 0 : Number(d.tax) || 0;
    const total = subtotal + taxAmt;
    let qy = ty + 18;
    const labelX = 400;
    const valX = 508;
    const totRow = (label, val, b = false) => {
        put(p1, label, labelX, qy, { size: 8.5, bold: b, color: b ? INK : MUTED });
        put(p1, val, valX, qy, { size: 8.5, bold: b });
        qy += 15;
    };
    totRow("SUBTOTAL", money(subtotal));
    totRow("TOTAL DISCOUNT", money(totalDisc));
    totRow("SALES TAX", taxExempt ? "EXEMPT" : money(taxAmt));
    p1.drawLine({ start: { x: labelX, y: T(qy - 4) }, end: { x: W - M, y: T(qy - 4) }, color: LINE, thickness: 0.7 });
    totRow("TOTAL", money(total), true);
    put(p1, "Thank you for your business!", M, 772, { size: 11, bold: true, color: ORANGE });
    // ================= PAGE 2: Terms + signature =================
    const p2 = pdf.addPage([W, H]);
    if (logo) {
        const lw = 92;
        const lh = (lw * 125) / 238;
        p2.drawImage(logo, { x: M, y: T(42) - lh, width: lw, height: lh });
    }
    put(p2, "Terms and Conditions", M, 128, { size: 15, bold: true });
    const terms = [
        `Pricing is valid until ${d.valid_until || d.due_date || "the date noted"}, unless otherwise noted.`,
        "Tax and shipping are not included unless otherwise stated.",
        "Payment is due in full by the net due date specified on the invoice. A service charge of 1.5% per month (18% annually), or the maximum allowed by law, will be assessed on all past due amounts.",
        "Product descriptions and available inventory are updated frequently and may change without notice. The pricing in this quote is based on current market conditions and is subject to change due to various factors, including but not limited to supply chain changes and external economic conditions, including tariffs. Should any of these factors result in a cost increase, we will inform you promptly and provide an updated pricing estimate.",
        "Any work, materials, or services not specifically listed in this quote are not included and may require a separate agreement or change order, which could result in additional costs.",
    ];
    let py = 156;
    for (const para of terms) {
        p2.drawText("•", { x: M, y: T(py), size: 9, font: helv, color: ORANGE });
        for (const l of wrap(para, helv, 9.5, W - 2 * M - 18)) {
            put(p2, l, M + 16, py, { size: 9.5, color: rgb(0.25, 0.27, 0.3) });
            py += 13;
        }
        py += 9;
    }
    py += 24;
    put(p2, "To accept this quotation, sign, print, date and return.", M, py, { size: 10, bold: true });
    py += 30;
    put(p2, "Signature: ______________________________________      Date: __________________", M, py, { size: 10 });
    py += 28;
    put(p2, "Print Name: ______________________________________", M, py, { size: 10 });
    put(p2, "Thank you for your business!", M, 772, { size: 11, bold: true, color: ORANGE });
    return pdf.save();
}
//# sourceMappingURL=quotepdf.js.map
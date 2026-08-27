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
// Clear zone on the Axus letterhead: below the top-right logo band, above the
// footer. Content must stay inside [TOP_SAFE, BOT_SAFE] (top-based Y).
const TOP_SAFE = 150;
const BOT_SAFE = 704;
const MAX_ROW_Y = 660; // items break to a new page past this (keeps them above the footer)
function money(n) {
    return "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export async function generateQuotePdf(d, opts = {}) {
    const tmpl = !!opts.template;
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    // Axus letterhead (corner banner + logo + faint watermark + footer) laid down
    // as a full-page background on every page, so quotes match the standard docs.
    let letter = null;
    try {
        letter = await pdf.embedJpg(await readFile(join(process.cwd(), "assets", "letterhead.jpg")));
    }
    catch {
        /* letterhead optional */
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
    // Full-page letterhead background. Call FIRST on every page, before content.
    const drawBg = (pg) => {
        if (letter)
            pg.drawImage(letter, { x: 0, y: 0, width: W, height: H });
    };
    // Column x-positions + a reusable item-table header (redrawn on each new page).
    const cx = { qty: M + 4, item: M + 46, desc: M + 150, unit: 398, disc: 458, total: 508 };
    const drawItemsHeader = (pg, top) => {
        pg.drawRectangle({ x: M, y: T(top + 4), width: W - 2 * M, height: 18, color: ORANGE });
        put(pg, "QTY", cx.qty, top, { size: 7.5, bold: true, color: WHITE });
        put(pg, "ITEM #", cx.item, top, { size: 7.5, bold: true, color: WHITE });
        put(pg, "DESCRIPTION", cx.desc, top, { size: 7.5, bold: true, color: WHITE });
        put(pg, "UNIT PRICE", cx.unit, top, { size: 7.5, bold: true, color: WHITE });
        put(pg, "DISC.", cx.disc, top, { size: 7.5, bold: true, color: WHITE });
        put(pg, "LINE TOTAL", cx.total, top, { size: 7.5, bold: true, color: WHITE });
        return top + 14;
    };
    // ================= PAGE 1 =================
    const p1 = pdf.addPage([W, H]);
    drawBg(p1);
    // Title sits top-LEFT (the letterhead logo owns the top-right corner). The
    // "from" address is dropped — the letterhead footer already carries it.
    put(p1, "QUOTE", M, TOP_SAFE + 6, { size: 24, bold: true });
    put(p1, tmpl ? "# ____________" : `# ${d.quote_number}`, M, TOP_SAFE + 26, { size: 10, color: MUTED });
    put(p1, tmpl ? "Date: ______________" : `Date: ${d.quote_date}`, M, TOP_SAFE + 40, { size: 10, color: MUTED });
    const tox = 330;
    let toy = TOP_SAFE + 2;
    put(p1, "QUOTE TO", tox, toy, { size: 8, bold: true, color: ORANGE });
    toy += 14;
    const toLines = tmpl
        ? ["______________________________", "______________________________", "______________________________"]
        : [
            d.customer.contact,
            d.customer.company,
            ...String(d.customer.address ?? "").split("\n"),
            d.customer.phone ? `Phone: ${d.customer.phone}` : "",
        ]
            .map((s) => (s ?? "").trim())
            .filter(Boolean);
    for (const l of toLines) {
        put(p1, l, tox, toy, { size: 9.5, color: tmpl ? MUTED : INK });
        toy += 12;
    }
    // Details strip
    const stripTop = TOP_SAFE + 70;
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
        const cxx = M + i * colW + 5;
        put(p1, c.h, cxx, stripTop + 12, { size: 6, bold: true, color: MUTED });
        put(p1, c.v || (tmpl ? "" : "—"), cxx, stripTop + 26, { size: 8.5 });
        if (i > 0)
            p1.drawLine({ start: { x: M + i * colW, y: T(stripTop) }, end: { x: M + i * colW, y: T(stripTop + stripH) }, color: LINE, thickness: 0.5 });
    });
    // ================= LINE ITEMS (paginated) =================
    let page = p1;
    let ty = stripTop + stripH + 24;
    ty = drawItemsHeader(page, ty);
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
        // Break to a new page (redraw the table header) when the row won't fit.
        if (ty + rowH > MAX_ROW_Y) {
            page = pdf.addPage([W, H]);
            drawBg(page);
            ty = drawItemsHeader(page, TOP_SAFE + 10);
        }
        put(page, tmpl ? "" : String(qty), cx.qty, ty + 11, { size: 8.5 });
        put(page, it.item, cx.item, ty + 11, { size: 8.5 });
        descLines.forEach((dl, i) => put(page, dl, cx.desc, ty + 11 + i * 10.5, { size: 8.5 }));
        put(page, tmpl ? "" : money(unit), cx.unit, ty + 11, { size: 8.5 });
        put(page, tmpl ? "" : disc ? money(disc) : "", cx.disc, ty + 11, { size: 8.5 });
        put(page, tmpl ? "" : money(lineTotal), cx.total, ty + 11, { size: 8.5 });
        ty += rowH;
        page.drawLine({ start: { x: M, y: T(ty) }, end: { x: W - M, y: T(ty) }, color: LINE, thickness: 0.4 });
    }
    // ================= TOTALS (same page, or a fresh one if tight) =================
    const taxExempt = !d.tax || /exempt/i.test(d.tax);
    const taxAmt = taxExempt ? 0 : Number(d.tax) || 0;
    const total = subtotal + taxAmt;
    if (ty + 85 > BOT_SAFE) {
        page = pdf.addPage([W, H]);
        drawBg(page);
        ty = TOP_SAFE + 10;
    }
    let qy = ty + 18;
    const labelX = 400;
    const valX = 508;
    const totRow = (label, val, b = false) => {
        put(page, label, labelX, qy, { size: 8.5, bold: b, color: b ? INK : MUTED });
        put(page, val, valX, qy, { size: 8.5, bold: b });
        qy += 15;
    };
    totRow("SUBTOTAL", tmpl ? "" : money(subtotal));
    totRow("TOTAL DISCOUNT", tmpl ? "" : money(totalDisc));
    totRow("SALES TAX", tmpl ? "" : taxExempt ? "EXEMPT" : money(taxAmt));
    // Divider sits in a clear gap between SALES TAX and TOTAL (no text overlap).
    qy += 4;
    page.drawLine({ start: { x: labelX, y: T(qy) }, end: { x: W - M, y: T(qy) }, color: LINE, thickness: 0.7 });
    qy += 14;
    totRow("TOTAL", tmpl ? "" : money(total), true);
    put(page, "Thank you for your business!", M, Math.min(qy + 16, BOT_SAFE), { size: 11, bold: true, color: ORANGE });
    // ================= TERMS + SIGNATURE (own page) =================
    const p2 = pdf.addPage([W, H]);
    drawBg(p2);
    put(p2, "Terms and Conditions", M, TOP_SAFE, { size: 15, bold: true });
    const terms = [
        `Pricing is valid until ${d.valid_until || d.due_date || "the date noted"}, unless otherwise noted.`,
        "Tax and shipping are not included unless otherwise stated.",
        "Payment is due in full by the net due date specified on the invoice. A service charge of 1.5% per month (18% annually), or the maximum allowed by law, will be assessed on all past due amounts.",
        "Product descriptions and available inventory are updated frequently and may change without notice. The pricing in this quote is based on current market conditions and is subject to change due to various factors, including but not limited to supply chain changes and external economic conditions, including tariffs. Should any of these factors result in a cost increase, we will inform you promptly and provide an updated pricing estimate.",
        "Any work, materials, or services not specifically listed in this quote are not included and may require a separate agreement or change order, which could result in additional costs.",
    ];
    let py = TOP_SAFE + 28;
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
    const SIG_LINE = "Signature: ______________________________________      Date: __________________";
    const NAME_LINE = "Print Name: ______________________________________";
    const sigY = py;
    put(p2, SIG_LINE, M, py, { size: 10 });
    py += 28;
    const nameY = py;
    put(p2, NAME_LINE, M, py, { size: 10 });
    // Signature-field layout (1 signer, page 2 — 1-based). Widths from exact text.
    const wAt = (s) => helv.widthOfTextAtSize(s, 10);
    const rect = (type, x0, x1, baseY) => ({
        type,
        page: 2,
        x: +(x0 / W).toFixed(4),
        y: +((baseY - 15) / H).toFixed(4),
        w: +((x1 - x0) / W).toFixed(4),
        h: +(17 / H).toFixed(4),
    });
    const sigPart = SIG_LINE.split("      Date:")[0]; // "Signature: ____…____"
    const layout = [
        {
            role: "Customer",
            fields: [
                rect("signature", M + wAt("Signature: "), M + wAt(sigPart), sigY),
                rect("date", M + wAt(`${sigPart}      Date: `), M + wAt(SIG_LINE), sigY),
                rect("name", M + wAt("Print Name: "), M + wAt(NAME_LINE), nameY),
            ],
        },
    ];
    return { bytes: await pdf.save(), layout };
}
// A blank, Axus-branded quote template for sales to fill in and hand back
// (they upload the finished .pdf/.doc). Same layout, empty cells.
export async function generateQuoteTemplatePdf() {
    const blankRows = Array.from({ length: 12 }, () => ({
        qty: 0,
        item: "",
        description: "",
        unit_price: 0,
        discount: 0,
    }));
    const { bytes } = await generateQuotePdf({
        quote_number: "",
        quote_date: "",
        customer: { company: "" },
        salesperson: "",
        job: "",
        shipping_method: "",
        delivery_date: "",
        payment_terms: "",
        due_date: "",
        items: blankRows,
        tax: "EXEMPT",
    }, { template: true });
    return bytes;
}
//# sourceMappingURL=quotepdf.js.map
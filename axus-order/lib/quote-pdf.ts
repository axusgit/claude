// lib/quote-pdf.ts
// Server-side quote PDF, rendered on the Axus letterhead with pdf-lib (pure JS —
// no headless browser, so it stays light on the shared box). Mirrors the on-screen
// "Quote for Guidance Purposes" document: customer info, line items, subtotal, and
// the legal disclaimer (kept whole — moved to the next page if it doesn't fit).
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const M_TOP = 2.35 * 72; // clear the letterhead header
const M_BOTTOM = 1.25 * 72; // clear the address footer
const M_SIDE = 0.85 * 72;
const CONTENT_R = PAGE_W - M_SIDE;

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.27, 0.27, 0.27);
const FAINT = rgb(0.42, 0.42, 0.42);
const ACCENT = rgb(0.702, 0.255, 0.059);
const CYAN = rgb(0.055, 0.455, 0.565);
const LINE = rgb(0.82, 0.82, 0.85);
const SOFT = rgb(1, 0.96, 0.937);

export interface QuotePdfLine {
  name: string;
  sku?: string | null;
  qty: number;
  unit: number | null;
  total: number | null;
  contact: boolean;
  note?: string | null; // e.g. "Suggested alternative — replaces …"
}
export interface QuotePdfData {
  quoteNumber: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  createdAt: Date;
  validUntil: Date;
  status: string;
  subtotal: number;
  lines: QuotePdfLine[];
  disclaimerTitle: string;
  disclaimerText: string;
  acceptedName?: string | null;
  acceptedAt?: Date | null;
}

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const approx = (n: number) => `~${usd0(n)}`;
const dateLong = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d);
const dateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const trial = cur ? cur + " " + word : word;
      if (font.widthOfTextAtSize(trial, size) > maxW && cur) {
        out.push(cur);
        cur = word;
      } else {
        cur = trial;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export async function generateQuotePdf(
  data: QuotePdfData,
  letterhead: Uint8Array,
  xMark?: Uint8Array
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const letterheadImg = await pdf.embedJpg(letterhead);
  const markImg = xMark ? await pdf.embedPng(xMark) : null;

  let page!: PDFPage;
  let y = 0;

  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawImage(letterheadImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    // Crisp Axus "X" watermark, centered, low opacity, behind the content.
    if (markImg) {
      const mw = 300;
      const mh = (markImg.height / markImg.width) * mw;
      page.drawImage(markImg, {
        x: (PAGE_W - mw) / 2,
        y: (PAGE_H - mh) / 2,
        width: mw,
        height: mh,
        opacity: 0.12,
      });
    }
    y = PAGE_H - M_TOP;
  };
  const need = (h: number) => {
    if (y - h < M_BOTTOM) addPage();
  };
  const rightText = (
    t: string,
    rx: number,
    size: number,
    f: PDFFont,
    color = INK,
    yy = y
  ) => {
    page.drawText(t, { x: rx - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color });
  };

  addPage();

  // --- Title ---
  page.drawText("Quote for Guidance Purposes", { x: M_SIDE, y, size: 20, font: bold, color: INK });
  // valid-until (right)
  const vu = `Valid until ${dateLong(data.validUntil)}`;
  page.drawText(vu, {
    x: CONTENT_R - font.widthOfTextAtSize(vu, 9),
    y: y + 6,
    size: 9,
    font,
    color: MUTED,
  });
  y -= 16;
  page.drawText(`#${data.quoteNumber}`, { x: M_SIDE, y, size: 9, font, color: FAINT });
  const st = data.status.toUpperCase();
  page.drawText(st, {
    x: CONTENT_R - font.widthOfTextAtSize(st, 8),
    y,
    size: 8,
    font: bold,
    color: data.validUntil.getTime() < Date.now() ? ACCENT : CYAN,
  });
  y -= 28;

  // --- Customer information ---
  page.drawText("CUSTOMER INFORMATION", { x: M_SIDE, y, size: 9, font: bold, color: CYAN });
  y -= 16;
  const col2 = M_SIDE + 250;
  const field = (label: string, value: string, x: number, yy: number) => {
    page.drawText(label.toUpperCase(), { x, y: yy, size: 7.5, font, color: FAINT });
    page.drawText(value || "—", { x: x + 62, y: yy, size: 10, font: bold, color: INK });
  };
  field("Name", data.customerName ?? "—", M_SIDE, y);
  field("Email", data.customerEmail ?? "—", col2, y);
  y -= 16;
  field("Organization", data.customerCompany ?? "—", M_SIDE, y);
  field("Date", dateLong(data.createdAt), col2, y);
  y -= 28;

  // --- Line items table ---
  const R_TOTAL = CONTENT_R; // right edge of "Line total"
  const R_UNIT = CONTENT_R - 95; // right edge of "Unit"
  const R_QTY = CONTENT_R - 185; // right edge of "Qty"
  const NAME_W = R_QTY - M_SIDE - 34; // item column width, clears the Qty column
  const NAME_LH = 13;
  const NOTE_LH = 11;
  const PAD_TOP = 11; // top edge -> first baseline
  const PAD_BOT = 9; // last baseline -> divider

  // header
  need(26);
  page.drawText("ITEM", { x: M_SIDE, y, size: 8, font: bold, color: FAINT });
  rightText("QTY", R_QTY, 8, bold, FAINT);
  rightText("UNIT (APPROX.)", R_UNIT, 8, bold, FAINT);
  rightText("LINE TOTAL", R_TOTAL, 8, bold, FAINT);
  y -= 7;
  page.drawLine({ start: { x: M_SIDE, y }, end: { x: CONTENT_R, y }, thickness: 0.75, color: LINE });

  // rows
  for (const l of data.lines) {
    const nameLines = wrap(l.name, bold, 10, NAME_W);
    const notes: string[] = [];
    if (l.note) notes.push(l.note);
    const sku = l.sku?.trim();
    if (sku && sku.length >= 4 && !/^mock-/i.test(sku)) notes.push(`SKU ${sku}`);
    if (l.contact) notes.push("Configurable / custom — we'll price this for you");
    const rowH = PAD_TOP + nameLines.length * NAME_LH + notes.length * NOTE_LH + PAD_BOT;
    need(rowH);

    const rowTop = y;
    const firstBaseline = rowTop - PAD_TOP;
    let ty = firstBaseline;
    for (const nl of nameLines) {
      page.drawText(nl, { x: M_SIDE, y: ty, size: 10, font: bold, color: INK });
      ty -= NAME_LH;
    }
    for (const nl of notes) {
      page.drawText(nl, {
        x: M_SIDE,
        y: ty,
        size: 8,
        font,
        color: nl.startsWith("SKU") || nl.startsWith("Suggested") ? CYAN : ACCENT,
      });
      ty -= NOTE_LH;
    }
    // Qty / Unit / Line total — aligned to the item's first line.
    rightText(String(l.qty), R_QTY, 10, font, MUTED, firstBaseline);
    if (l.contact || l.unit == null) rightText("Contact us", R_UNIT, 10, font, ACCENT, firstBaseline);
    else rightText(approx(l.unit), R_UNIT, 10, font, INK, firstBaseline);
    if (l.contact || l.total == null) rightText("Contact us", R_TOTAL, 10, bold, ACCENT, firstBaseline);
    else rightText(approx(l.total), R_TOTAL, 10, bold, INK, firstBaseline);

    // ty sits one line-height below the last drawn baseline; recover it.
    const lastLH = notes.length ? NOTE_LH : NAME_LH;
    const divY = ty + lastLH - PAD_BOT;
    page.drawLine({ start: { x: M_SIDE, y: divY }, end: { x: CONTENT_R, y: divY }, thickness: 0.5, color: LINE });
    y = divY;
  }

  // --- Subtotal ---
  need(30);
  y -= 18;
  const sLabel = "Subtotal (approx., priced items)";
  page.drawText(sLabel, {
    x: R_UNIT - font.widthOfTextAtSize(sLabel, 10),
    y,
    size: 10,
    font,
    color: MUTED,
  });
  rightText(approx(data.subtotal), R_TOTAL, 14, bold, ACCENT);
  y -= 30;

  // --- Disclaimer (kept whole) ---
  const dTitleSize = 11;
  const dBodySize = 8.5;
  const innerW = CONTENT_R - M_SIDE - 24; // 12pt padding each side
  const bodyLines = wrap(data.disclaimerText, font, dBodySize, innerW);
  const acceptLine =
    data.acceptedName && data.acceptedAt
      ? `Accepted by ${data.acceptedName} on ${dateTime(data.acceptedAt)}.`
      : null;
  const boxH =
    12 + dTitleSize + 10 + bodyLines.length * (dBodySize + 3.5) + (acceptLine ? 18 : 0) + 12;
  need(boxH);
  const boxTop = y;
  const boxBottom = y - boxH;
  page.drawRectangle({
    x: M_SIDE,
    y: boxBottom,
    width: CONTENT_R - M_SIDE,
    height: boxH,
    color: SOFT,
    borderColor: rgb(0.95, 0.78, 0.68),
    borderWidth: 0.75,
  });
  let dy = boxTop - 14 - dTitleSize + dTitleSize; // start baseline
  dy = boxTop - 22;
  page.drawText(data.disclaimerTitle, { x: M_SIDE + 12, y: dy, size: dTitleSize, font: bold, color: ACCENT });
  dy -= 18;
  for (const bl of bodyLines) {
    if (bl === "") {
      dy -= dBodySize * 0.7;
      continue;
    }
    page.drawText(bl, { x: M_SIDE + 12, y: dy, size: dBodySize, font, color: MUTED });
    dy -= dBodySize + 3.5;
  }
  if (acceptLine) {
    dy -= 4;
    page.drawText(acceptLine, { x: M_SIDE + 12, y: dy, size: 8, font, color: MUTED });
  }

  return pdf.save();
}

// Axus Technologies — Subcontractor Agreement generator.
// Rendered on the Axus letterhead with the Subcontractor legal name + Effective
// Date baked in. ONE signer block (Subcontractor: Signature/Date then Print
// Name/Title) sits on a DEDICATED FINAL PAGE so the returned layout is
// deterministic; an Axus acceptance block is drawn beneath it (static, for
// countersignature). Body text = plain-language v1.0; edit SUB_BLOCKS to change
// terms and bump the Doc. No. version string to version it.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type Color } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SignField, SignSlot } from "./quotepdf.js";

const ORANGE = rgb(0.92, 0.35, 0.05);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const W = 612;
const H = 792;
const M = 64;
const TOP_SAFE = 150;
const BOT_SAFE = 704;

export interface SubData {
  company?: string; // Subcontractor legal name (baked in)
  dateLong?: string; // Effective Date (baked in), e.g. "September 29, 2026"
  state?: string; // accepted for compatibility; governing law is Florida in the body
}

type Block = { t: "h" | "p"; s: string; indent?: number };

const SUB_BLOCKS: Block[] = [
  { t: "p", s: "This Subcontractor Agreement (“Agreement”) is between Axus Technologies (“Axus,” “we,” “us”) and [SUBCONTRACTOR LEGAL NAME] (“Subcontractor,” “you”), effective [EFFECTIVE DATE]." },
  { t: "p", s: "We work together so Axus can deliver great service to its clients. This Agreement sets the ground rules in plain terms. If anything here is unclear, ask us — we’re happy to talk it through." },

  { t: "h", s: "1. What you’ll do" },
  { t: "p", s: "From time to time we’ll ask you to perform specific work. The details of each job — scope, location, schedule, and price — will be described in a work order, purchase order, or written request that we both agree to before you start. You decide how to do the work using your own skills, tools, and methods; we care about the result and doing right by the client." },

  { t: "h", s: "2. You’re an independent contractor" },
  { t: "p", s: "You’re running your own business, not working as an Axus employee. That means:" },
  { t: "p", s: "•  You control your own schedule, methods, and staff.", indent: 14 },
  { t: "p", s: "•  You’re responsible for your own taxes, licenses, and insurance.", indent: 14 },
  { t: "p", s: "•  You’ll provide a completed IRS Form W-9 before your first payment.", indent: 14 },
  { t: "p", s: "•  Nothing here creates a partnership, joint venture, or employment relationship.", indent: 14 },

  { t: "h", s: "3. Insurance" },
  { t: "p", s: "Please carry commercial general liability insurance appropriate for the work, and any coverage required by law (e.g., workers’ compensation where applicable)." },
  { t: "p", s: "Provide a current Certificate of Insurance (COI) that names Axus Technologies as an additional insured:" },
  { t: "p", s: "Axus Technologies", indent: 22 },
  { t: "p", s: "13046 Racetrack Rd., Suite 255", indent: 22 },
  { t: "p", s: "Tampa, FL 33626", indent: 22 },
  { t: "p", s: "Keep the COI current for as long as you do work for us; we’ll remind you before it expires." },

  { t: "h", s: "4. Payment" },
  { t: "p", s: "We’ll pay the agreed price for each job per the terms in the work order, normally within [NET __ DAYS] of an approved invoice. If a client hasn’t paid us for reasons unrelated to your work, that’s on us — it won’t be used as a reason to withhold what you’ve earned." },

  { t: "h", s: "5. Confidentiality and client data" },
  { t: "p", s: "In the course of the work you may learn non-public information about Axus or our clients. Please keep it confidential and use it only to do the job. Protect any client data you handle with reasonable care, and return or delete it when the work is done or when we ask. This section continues after the Agreement ends. It doesn’t cover information that’s public, that you already knew, or that you’re legally required to disclose." },

  { t: "h", s: "6. Work product" },
  { t: "p", s: "Deliverables you create specifically for an Axus client as part of a job belong to Axus (or the client) once you’ve been paid for that job. You keep ownership of your own pre-existing tools, templates, and know-how, and you’re free to reuse your general skills and experience." },

  { t: "h", s: "7. Professional conduct" },
  { t: "p", s: "Do good work, follow reasonable site and safety rules, treat clients and their people with respect, and hold any licenses or certifications your work requires. If something goes wrong, tell us promptly so we can help make it right." },

  { t: "h", s: "8. Non-solicitation (limited)" },
  { t: "p", s: "While you’re working with us and for 12 months afterward, please don’t directly solicit an Axus client you were introduced to through us to take their business away from Axus. This is meant to protect the client relationships we bring you — it is not meant to stop you from working in your field, serving your own existing clients, or responding to general advertising. If a specific situation is unclear, talk to us; we’re reasonable about this." },

  { t: "h", s: "9. Responsibility for problems (mutual)" },
  { t: "p", s: "Each of us will cover the other for losses we cause to third parties through our own negligence or willful misconduct. In other words, you’re responsible for problems you cause, and we’re responsible for problems we cause. Neither of us is responsible for the other’s mistakes." },

  { t: "h", s: "10. Limits on liability (mutual)" },
  { t: "p", s: "Neither party is liable to the other for indirect or consequential damages (like lost profits). Except for the confidentiality and insurance obligations and each party’s indemnity above, each party’s total liability under this Agreement is capped at the amounts paid for the job that gave rise to the claim. This keeps risk proportional to the size of the work." },

  { t: "h", s: "11. Term and ending the Agreement" },
  { t: "p", s: "This Agreement stays in place while we’re doing business together. Either of us can end it for any reason with 30 days’ written notice, and either of us can end it sooner if the other materially breaches it and doesn’t fix the problem within 15 days of notice. Any job already underway should be wound down professionally, and you’ll be paid for work properly performed." },

  { t: "h", s: "12. Renewal" },
  { t: "p", s: "To keep records current, we ask subcontractors to re-sign the then-current version of this Agreement every 24 months. We’ll send a reminder ahead of time." },

  { t: "h", s: "13. The fine print" },
  { t: "p", s: "•  Governing law: the State of Florida.", indent: 14 },
  { t: "p", s: "•  Assignment: neither party assigns this Agreement without the other’s consent (except to a successor of its business).", indent: 14 },
  { t: "p", s: "•  Entire agreement: this document plus the work orders is the whole deal between us and replaces any prior subcontractor agreement.", indent: 14 },
  { t: "p", s: "•  Changes: any changes should be in writing and agreed by both of us.", indent: 14 },
  { t: "p", s: "•  Survival: sections 5 (Confidentiality), 6 (Work product), 8 (Non-solicitation), 9–10 (Responsibility/Liability) continue after the Agreement ends.", indent: 14 },
];

function buildBody(company: string, dateLong: string): Block[] {
  return SUB_BLOCKS.map((b) => ({
    t: b.t,
    indent: b.indent,
    s: b.s.replace(/\[EFFECTIVE DATE\]/g, dateLong).replace(/\[SUBCONTRACTOR LEGAL NAME\]/g, company),
  }));
}

export async function generateSubPdf(
  d: SubData = {},
  opts: { assetsDir?: string } = {},
): Promise<{ bytes: Uint8Array; layout: SignSlot[] }> {
  const assetsDir = opts.assetsDir ?? join(process.cwd(), "assets");
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let letter: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null;
  try {
    letter = await pdf.embedJpg(await readFile(join(assetsDir, "letterhead.jpg")));
  } catch {
    /* letterhead optional */
  }

  const company = d.company?.trim() || "the Subcontractor";
  const dateLong = d.dateLong?.trim() || "____________________";

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const T = (topY: number) => H - topY;

  const wrap = (raw: string, font: PDFFont, size: number, maxW: number): string[] => {
    const words = String(raw ?? "").split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    if (letter) page.drawImage(letter, { x: 0, y: 0, width: W, height: H });
    y = TOP_SAFE;
  };

  const ensure = (space: number) => {
    if (y + space > BOT_SAFE) newPage();
  };

  // Helvetica is WinAnsi/CP1252-encoded; normalize glyphs outside that set.
  const san = (s: string) =>
    s.replace(/[‐‑]/g, "-").replace(/−/g, "-").replace(/ /g, " ");

  const block = (
    text: string,
    o: { size?: number; font?: PDFFont; color?: Color; lead?: number; after?: number; indent?: number } = {},
  ) => {
    const size = o.size ?? 9.7;
    const font = o.font ?? helv;
    const lead = o.lead ?? size + 3.2;
    const indent = o.indent ?? 0;
    for (const ln of wrap(san(text), font, size, W - 2 * M - indent)) {
      ensure(lead);
      page.drawText(ln, { x: M + indent, y: T(y), size, font, color: o.color ?? INK });
      y += lead;
    }
    y += o.after ?? 5;
  };

  // ---- Page 1: title ----
  newPage();
  block("Subcontractor Agreement", { size: 19, font: bold, lead: 23, after: 2 });
  block("Independent Subcontractor Terms", { size: 9, color: MUTED, lead: 12, after: 1 });
  block("Plain-Language Form  |  Version 1.0  |  September 2026  |  Doc. No. 2026-AXUS-SUB-001.0", { size: 8, color: MUTED, lead: 11, after: 10 });

  // ---- Body ----
  for (const b of buildBody(company, dateLong)) {
    if (b.t === "h") {
      ensure(46);
      y += 8;
      block(b.s.toUpperCase(), { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
    } else {
      block(b.s, { indent: b.indent });
    }
  }

  // ================= SIGNATURES — dedicated final page =================
  newPage();
  block("14. SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block("By signing, each person confirms they’re authorized to sign for their company and agree to this Agreement.", { after: 12 });

  const sigPage = pages.length;
  const leftLabelX = M; // 64
  const rightLabelX = 336;
  const leftLineEnd = 316;
  const rightLineEnd = W - M; // 548

  const fieldFor = (
    type: SignField["type"],
    labelX: number,
    label: string,
    lineEnd: number,
    ry: number,
    withField: boolean,
  ): SignField | null => {
    page.drawText(label, { x: labelX, y: T(ry), size: 10, font: helv, color: INK });
    const fx = labelX + helv.widthOfTextAtSize(label, 10) + 6;
    page.drawLine({ start: { x: fx, y: T(ry) - 2 }, end: { x: lineEnd, y: T(ry) - 2 }, thickness: 0.6, color: rgb(0.55, 0.57, 0.6) });
    if (!withField) return null;
    return {
      type,
      page: sigPage,
      x: +(fx / W).toFixed(4),
      y: +((ry - 12) / H).toFixed(4),
      w: +((lineEnd - fx) / W).toFixed(4),
      h: +(15 / H).toFixed(4),
    };
  };

  const sigBlock = (role: string, heading: string, topY: number, withFields: boolean): SignSlot => {
    page.drawText(san(heading), { x: leftLabelX, y: T(topY), size: 10.5, font: bold, color: ORANGE });
    const r1 = topY + 26; // Signature / Date
    const r2 = topY + 54; // Print Name / Title
    const fields = [
      fieldFor("signature", leftLabelX, "Signature:", leftLineEnd, r1, withFields),
      fieldFor("date", rightLabelX, "Date:", rightLineEnd, r1, withFields),
      fieldFor("name", leftLabelX, "Print Name:", leftLineEnd, r2, withFields),
      fieldFor("title", rightLabelX, "Title:", rightLineEnd, r2, withFields),
    ].filter((f): f is SignField => f !== null);
    return { role, fields };
  };

  // The Subcontractor is the e-signer (fields wired). Axus signs as a static
  // acceptance block (drawn lines, no interactive fields).
  const subName = company === "the Subcontractor" ? "Subcontractor" : company;
  const subSlot = sigBlock("Subcontractor", `${subName} - Authorized Representative`, 300, true);
  sigBlock("Axus Technologies", "Axus Technologies, LLC - Authorized Representative", 396, false);

  // ---- Page numbers ----
  const total = pages.length;
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: T(722), size: 7.5, font: helv, color: MUTED });
  });

  return { bytes: await pdf.save(), layout: [subSlot] };
}

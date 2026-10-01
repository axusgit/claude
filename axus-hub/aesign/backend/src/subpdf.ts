// Axus Master Subcontractor Agreement generator.
// Rendered on the Axus letterhead (assets/letterhead.jpg, drawn full-page on every
// page) with the subcontractor's info baked into the party block. Body text is the
// approved Master Subcontractor Agreement (verbatim, extracted from the fillable
// form) — edit SUB_BLOCKS to change terms. The Effective Date is left blank and
// auto-fills to the signer's date via an eSign date field on page 1. Signatures sit
// on a DEDICATED FINAL PAGE (SOW-style blocks), so the returned layout is
// deterministic. Mirrors slapdf.ts.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type Color } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SignField, SignSlot } from "./quotepdf.js";

const ORANGE = rgb(0.92, 0.35, 0.05);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.8, 0.82, 0.85);
const W = 612;
const H = 792;
const M = 64;
// Clear zone on the Axus letterhead (below the top-right logo, above the contact strip).
const TOP_SAFE = 150;
const BOT_SAFE = 704;

const AXUS_NOTICE_EMAIL = "info@axustechnologies.com";
const AXUS_PHONE = "(813)922-2323";


export interface SubData {
  company?: string; // Subcontractor legal name (baked in)
  address?: string;
  csz?: string; // City / State / ZIP
  email?: string;
  phone?: string;
  dateLong?: string; // accepted for compatibility; NOT written (Effective Date stays blank)
}

type Block = { t: "h" | "p"; s: string };

const SUB_BLOCKS: Block[] = [
  { t: "p", s: "Axus and Subcontractor are each a “Party” and together the “Parties.” This is a master agreement. Work is authorized only by a Scope of Work (“SOW”)." },
  { t: "p", s: "Complete the SOW below or attach a later SOW. Shaded boxes are the only fields intended to be completed." },
  { t: "h", s: "1.  Term" },
  { t: "p", s: "This Agreement begins on the Effective Date, continues for one (1) year, and then automatically renews for successive one-year terms unless a Party gives at least thirty (30) days’ prior written notice that it will not renew, or until earlier terminated under Section 12. The initial term and any renewal are each a “Term.”" },
  { t: "h", s: "2.  Scopes of Work" },
  { t: "p", s: "The Parties will use a written SOW for each engagement (including the SOW on page 2 or a later signed or electronically accepted SOW). Each SOW supplements this Agreement. If an SOW expressly conflicts with this Agreement, the SOW controls for that project only." },
  { t: "h", s: "3.  Services, Invoicing, and Payment" },
  { t: "p", s: "Subcontractor will perform the services described in each SOW (the “Services”). Axus will pay the fees stated in the applicable SOW. The hourly rate, trip charge, and notes in Exhibit A are the baseline for that engagement unless a later signed or accepted SOW states different figures. Unless an SOW says otherwise: (a) Subcontractor will send Axus a reasonably detailed invoice within fifteen (15) days after month-end or after completing a discrete SOW; (b) undisputed amounts are due Net 30 from Axus’s receipt of a proper invoice; (c) Axus will describe any good-faith dispute in writing within fifteen (15) days after receipt and will pay the undisputed portion when due; and (d) late undisputed amounts accrue simple interest of one percent (1%) per month, or the maximum rate allowed by law, whichever is less. Subcontractor will look solely to Axus for payment and will not invoice, demand payment from, or place a lien against any Axus customer or any customer property." },
  { t: "h", s: "4.  Independent Contractor" },
  { t: "p", s: "The Parties are independent contractors. Nothing in this Agreement creates an employment, partnership, agency, or joint-venture relationship. Subcontractor controls the manner, means, sequence, and methods of the Services and may use its own employees or lower-tier subcontractors. Axus may identify customer requirements, site rules, safety rules, and requested service windows, but will not control Subcontractor’s day-to-day methods or require exclusive service to Axus. Subcontractor may perform work for others, including other information-technology providers, subject to Sections 7–9. Subcontractor will supply ordinary tools and equipment, including a phone and a computer. Axus may loan unique tools or test equipment, which Subcontractor will return on request or when the related SOW ends. Axus will not withhold taxes or FICA and will not provide employee benefits or workers’ compensation for Subcontractor’s personnel. Subcontractor is solely responsible for its taxes, licenses, insurance, and employment obligations." },
  { t: "h", s: "5.  Qualifications and Insurance" },
  { t: "p", s: "While this Agreement is in effect, Subcontractor will, at its own cost: (a) remain validly organized and in good standing in its state of formation; (b) maintain workers’ compensation coverage for personnel performing Services, or hold a valid exemption under Florida Statutes § 440.05 or a comparable law of the governing state; and (c) maintain commercial general liability insurance of at least $1,000,000 per occurrence and $3,000,000 aggregate, and automobile liability insurance (owned, hired, and non-owned) of at least $1,000,000 combined single limit. On request, Subcontractor will name Axus as an additional insured where the carrier permits. Subcontractor will give Axus certificates of insurance or exemption within ten (10) business days after request and upon renewal." },
  { t: "h", s: "6.  Performance and Personnel" },
  { t: "p", s: "Subcontractor will supervise its personnel and any lower-tier subcontractors and is responsible for timely, workmanlike completion of each SOW. If Subcontractor uses a lower-tier subcontractor, Subcontractor remains fully responsible for that work. For Sections 7–9, “Subcontractor” includes Subcontractor’s subsidiaries, affiliates, owners, officers, employees, agents, and lower-tier subcontractors. Subcontractor will bind those persons and firms to confidentiality and non-solicitation terms no less protective than Sections 7–9 and is responsible for their compliance." },
  { t: "h", s: "7.  Confidentiality" },
  { t: "p", s: "“Confidential Information” means non-public information relating to Axus or an Axus customer that Subcontractor or any Covered Person learns in connection with this Agreement, including customer identities, customer lists, referral sources, pricing, credentials, network documentation, financial data, personnel information, and business plans, whether or not marked confidential. “Covered Person” means Subcontractor’s subsidiaries, affiliates, owners, officers, employees, agents, and lower-tier subcontractors. Confidential Information does not include information that is or becomes public through no fault of Subcontractor or a Covered Person, that Subcontractor independently develops without use of Confidential Information, or that Subcontractor rightfully receives from a third party without a duty of confidentiality. Subcontractor and each Covered Person will use Confidential Information only to perform the Services, disclose it only to personnel with a need to know who are bound to protect it, and use at least reasonable care. Subcontractor is responsible for any unauthorized use or disclosure by a Covered Person. On request or at the end of the Term, Subcontractor will return or securely destroy Confidential Information, except one archival copy retained by counsel or as required by law. These duties last during the Term and for three (3) years after it ends; trade secrets remain protected for so long as they qualify as trade secrets under applicable law. Axus will protect Subcontractor’s non-public pricing, methods, and personnel information for the same periods." },
  { t: "h", s: "8.  Non-Solicitation of Customers and Personnel (24 Months)" },
  { t: "p", s: "To protect Axus’s substantial customer, referral, and workforce relationships, during the Term and for twenty-four (24) months after the Term ends, Subcontractor will not, directly or indirectly: (a) solicit or accept information-technology consulting work of the kind Axus provides from a Restricted Customer; (b) encourage a Restricted Customer to stop, reduce, or divert business from Axus; or (c) solicit, recruit, hire, or engage any Restricted Person to leave Axus or to perform information-technology work in competition with Axus. “Restricted Customer” means an Axus customer (i) for whom Subcontractor performed Services, or (ii) whose identity, needs, or contact information Subcontractor learned through the Services or Axus Confidential Information, in each case during the twelve (12) months before the restricted activity or before the Term ended, whichever is earlier. “Restricted Person” means an employee, contractor, or agent of Axus with whom Subcontractor had material contact, or about whom Subcontractor learned Confidential Information, during that same period. This Section is not a general non-compete. Subcontractor may work in the same industry and for other customers, and may hire persons who respond on their own to a general advertisement not targeted at Axus personnel. The customer restriction applies only in the geographic areas where the Restricted Customer received the Services. If a court finds any part of this Section overbroad, it may modify that part to the minimum extent needed for enforceability under Florida Statutes § 542.335. Time during which Subcontractor is in proven material breach of this Section does not count toward the 24-month period." },
  { t: "h", s: "9.  Non-Circumvention and Customer Contact" },
  { t: "p", s: "Axus is Subcontractor’s client even when Services are delivered at an Axus customer site. During an active SOW, Subcontractor may contact that customer as needed to perform the Services. Subcontractor will not, without Axus’s prior written consent, send invoices to an Axus customer, negotiate separate pricing or a direct engagement with a Restricted Customer for services of the kind Axus provides, or hold itself out as contracting directly with that customer for the Services." },
  { t: "h", s: "10.  Mutual Non-Disparagement" },
  { t: "p", s: "Neither Party will make a false or defamatory statement about the other Party or its owners, managers, or personnel. This Section does not prohibit truthful statements required by law, made in a legal, arbitration, or administrative proceeding, or made to a government agency." },
  { t: "h", s: "11.  Remedies" },
  { t: "p", s: "Sections 7–10 are material. A breach may cause irreparable harm for which money damages may be inadequate. Either Party may seek temporary or permanent injunctive relief in addition to any other available remedy. Remedies are cumulative. Damages, if awarded, will be actual damages proven in court or arbitration, not predetermined liquidated amounts. Nothing in this Section limits a court’s authority under Florida law, including Florida Statutes § 542.335." },
  { t: "h", s: "12.  Termination" },
  { t: "p", s: "Either Party may terminate this Agreement or any SOW for convenience on thirty (30) days’ prior written notice. Either Party may terminate this Agreement or any SOW for material breach if the other Party does not cure within ten (10) business days after written notice describing the breach. No cure period is required for a material breach of Section 7, fraud, loss of required insurance or formation status, or failure to pay an undisputed amount more than thirty (30) days after the dispute-notice period in Section 3. On termination: (a) Axus will pay undisputed amounts owed for Services properly performed through the effective date of termination; (b) Subcontractor will promptly return Axus property, customer materials, and Confidential Information as required by Section 7; and (c) Sections 3 (as to earned and disputed fees), 7–11, and 13–20 survive according to their terms." },
  { t: "h", s: "13.  Limited Non-Disclosure of Terms" },
  { t: "p", s: "Neither Party will publicly disclose the specific commercial terms of this Agreement except as required by law, to professional advisors under a duty of confidentiality, or as reasonably needed to perform an SOW. Either Party may disclose the existence of a working relationship where reasonably necessary." },
  { t: "h", s: "14.  Entire Agreement; Amendment" },
  { t: "p", s: "This Agreement, including each SOW, is the entire agreement on its subject and supersedes prior oral or written discussions about that subject. It may be amended only by a written instrument signed or electronically accepted by both Parties." },
  { t: "h", s: "15.  Governing Law and Venue" },
  { t: "p", s: "This Agreement is governed by the laws of the State of Florida, without regard to conflict-of-law rules. Exclusive venue for any action arising out of this Agreement is the state or federal courts located in Hillsborough County, Florida. Each Party consents to that venue." },
  { t: "h", s: "16.  Attorneys’ Fees" },
  { t: "p", s: "The prevailing Party in an action to enforce this Agreement is entitled to recover its reasonable attorneys’ fees and costs from the other Party." },
  { t: "h", s: "17.  Severability; Waiver; Construction" },
  { t: "p", s: "If any provision is held invalid or unenforceable, the remaining provisions remain in effect. A waiver must be in writing and is not a continuing waiver. This Agreement will not be construed against either Party as drafter. The covenants in Sections 7–10 are independent. A breach by one Party does not excuse the other Party’s breach of those covenants, except that Axus’s uncured non-payment of undisputed fees may be raised as a defense to a later non-solicit claim arising after that non-payment." },
  { t: "h", s: "18.  Mutual Indemnification" },
  { t: "p", s: "Subcontractor will indemnify, defend, and hold harmless Axus from third-party claims, damages, and reasonable expenses to the extent caused by the negligence, willful misconduct, or breach of this Agreement by Subcontractor or its personnel in performing the Services. Axus will indemnify, defend, and hold harmless Subcontractor from third-party claims, damages, and reasonable expenses to the extent caused by Axus’s negligence, willful misconduct, or breach of this Agreement. Neither Party must indemnify the other for the other’s gross negligence or willful misconduct." },
  { t: "h", s: "19.  Intellectual Property" },
  { t: "p", s: "Each Party retains its pre-existing intellectual property. Subject to the customer’s rights and any SOW, deliverables created specifically for an Axus customer under an SOW are assigned to Axus or to the customer as Axus directs. Subcontractor grants Axus a non-exclusive, perpetual, paid-up license to use Subcontractor’s pre-existing materials that are embedded in those deliverables, solely as needed to use, maintain, and support the deliverables." },
  { t: "h", s: "20.  Notices; Counterparts; Electronic Signatures" },
  { t: "p", s: "Notices may be sent to the addresses or emails stated in this Agreement, or to updated coordinates given in writing. This Agreement may be signed in counterparts, including electronic signatures, which together are one instrument. Electronic records and signatures are intended to be valid under the federal ESIGN Act and the Florida Uniform Electronic Transaction Act. Each signer represents that the signer is authorized to bind the named Party, has read this Agreement, and had an opportunity to obtain independent legal advice. This form is a working draft for business use; it is not a substitute for advice from Florida counsel on a particular engagement." },
];

export async function generateSubPdf(
  d: SubData = {},
  opts: { assetsDir?: string; templatesDir?: string } = {},
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

  const company = (d.company ?? "").trim();
  const subName = company || "Subcontractor";

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // baseline of the next line, from the top of the page
  const T = (topY: number) => H - topY;

  // Standard Helvetica is WinAnsi/CP1252; normalize the few glyphs outside that set.
  const san = (s: string) => s.replace(/−/g, "-");

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

  // ---- Page 1: title (letterhead carries the logo top-right) ----
  newPage();
  block("Master Subcontractor Agreement", { size: 19, font: bold, lead: 23, after: 10 });

  // ---- Party block — shaded form fields (auto-populated) ----
  let effField!: SignField;
  const subExtraFields: SignField[] = []; // extra fillable party-block fields (subcontractor)
  const FBOX = rgb(0.985, 0.965, 0.93); // cream fill
  const FBORD = rgb(0.87, 0.84, 0.78);
  const FLABEL = rgb(0.34, 0.37, 0.42);
  const BOXH = 15;
  const COL_L = M; // 64
  const COL_R = 316;
  const CW = 232; // half-row box width
  const FROW = 30; // vertical advance per label+box row

  // Shaded field box at the current y; returns its top (from page top).
  const drawBox = (x: number, w: number) => {
    const topY = y + 3;
    page.drawRectangle({ x, y: T(topY + BOXH), width: w, height: BOXH, color: FBOX, borderColor: FBORD, borderWidth: 0.5 });
    return topY;
  };
  // Labeled shaded field cell; returns its box rect (normalized) for an eSign overlay.
  // page is captured as the CURRENT page (pages.length) so fields on Exhibit A land
  // on the right page, not page 1.
  const fieldCell = (
    label: string,
    value: string,
    x: number,
    w: number,
    opts: { type?: SignField["type"]; required?: boolean; options?: string[]; key?: string } = {},
  ): SignField => {
    page.drawText(label, { x, y: T(y), size: 7.8, font: bold, color: FLABEL });
    const topY = drawBox(x, w);
    if (value) page.drawText(value, { x: x + 6, y: T(topY + BOXH - 4.5), size: 9.5, font: helv, color: INK });
    else if (opts.type === "select")
      page.drawText("Select…", { x: x + 6, y: T(topY + BOXH - 4.5), size: 9, font: helv, color: rgb(0.62, 0.64, 0.68) });
    const f: SignField = {
      type: opts.type ?? "text",
      page: pages.length,
      x: +(x / W).toFixed(4), y: +(topY / H).toFixed(4), w: +(w / W).toFixed(4), h: +(BOXH / H).toFixed(4),
    };
    if (opts.required !== undefined) f.required = opts.required;
    if (opts.options) f.options = opts.options;
    if (opts.key) f.key = opts.key;
    return f;
  };
  // Small FILLABLE checkbox with a label to its right; returns its field rect + end x.
  const CB = 13;
  const checkbox = (labelTxt: string, cx: number, cbY: number, key?: string): { field: SignField; endX: number } => {
    page.drawRectangle({ x: cx, y: T(cbY + CB), width: CB, height: CB, color: FBOX, borderColor: FBORD, borderWidth: 0.6 });
    page.drawText(labelTxt, { x: cx + CB + 4, y: T(cbY + CB - 3), size: 9.5, font: helv, color: INK });
    const lw = helv.widthOfTextAtSize(labelTxt, 9.5);
    const field: SignField = {
      type: "checkbox", page: pages.length,
      x: +(cx / W).toFixed(4), y: +(cbY / H).toFixed(4), w: +(CB / W).toFixed(4), h: +(CB / H).toFixed(4),
      required: false, group: "entity_type",
    };
    if (key) field.key = key;
    return { field, endX: cx + CB + 4 + lw };
  };

  ensure(FROW * 7 + 40);
  block("This Agreement is between Axus Technologies, LLC (“Axus”) and:", { size: 9.5, lead: 14, after: 7 });
  fieldCell("SUBCONTRACTOR LEGAL NAME", subName, COL_L, W - 2 * M); y += FROW;
  {
    const eff = fieldCell("EFFECTIVE DATE", "", COL_L, CW);
    effField = { ...eff, type: "date" };
    // State of Formation = required text field (signer types it).
    const stateCell = fieldCell("STATE OF FORMATION", "", COL_R, CW, { required: true });
    subExtraFields.push(stateCell);
    y += FROW;
  }
  {
    // Entity type — fillable checkboxes (LLC / Corporation / Other + Other text) | EIN.
    // Exactly one must be selected; if Other, the Other text is required (enforced in the signer UI).
    page.drawText("ENTITY TYPE", { x: COL_L, y: T(y), size: 7.8, font: bold, color: FLABEL });
    const cbY = y + 3;
    const llc = checkbox("LLC", COL_L, cbY);
    const corp = checkbox("Corporation", llc.endX + 16, cbY);
    const other = checkbox("Other:", corp.endX + 16, cbY, "entity_other");
    const otherX = other.endX + 6;
    const otherEnd = COL_R - 12;
    page.drawRectangle({ x: otherX, y: T(cbY + CB), width: otherEnd - otherX, height: CB, color: FBOX, borderColor: FBORD, borderWidth: 0.5 });
    const otherText: SignField = {
      type: "text", page: pages.length, key: "entity_other_text",
      x: +(otherX / W).toFixed(4), y: +(cbY / H).toFixed(4),
      w: +((otherEnd - otherX) / W).toFixed(4), h: +(CB / H).toFixed(4), required: false,
    };
    const einCell = fieldCell("EIN (OPTIONAL)", "", COL_R, CW);
    subExtraFields.push(llc.field, corp.field, other.field, otherText, { ...einCell, required: false });
    y += FROW;
  }
  fieldCell("ADDRESS", (d.address ?? "").trim(), COL_L, W - 2 * M); y += FROW;
  fieldCell("CITY / STATE / ZIP", (d.csz ?? "").trim(), COL_L, W - 2 * M); y += FROW;
  fieldCell("EMAIL", (d.email ?? "").trim(), COL_L, CW);
  fieldCell("PHONE", (d.phone ?? "").trim(), COL_R, CW);
  y += FROW;
  fieldCell("AXUS NOTICE EMAIL", AXUS_NOTICE_EMAIL, COL_L, CW);
  fieldCell("AXUS PHONE", AXUS_PHONE, COL_R, CW);
  y += FROW;

  y += 2;
  page.drawLine({ start: { x: M, y: T(y) }, end: { x: W - M, y: T(y) }, thickness: 0.6, color: RULE });
  y += 12;

  // ---- Body ----
  for (const b of SUB_BLOCKS) {
    if (b.t === "h") {
      ensure(46);
      y += 8;
      block(b.s.toUpperCase(), { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
    } else {
      block(b.s);
    }
  }

  // ---- Exhibit A: Scope of Work (blank; filled per engagement) ----
  ensure(FROW * 4 + 60);
  y += 8;
  block("SCOPE OF WORK (EXHIBIT A)", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 1 });
  block("Baseline rates and notes; a later SOW may update these figures.", { size: 9, color: MUTED, lead: 12, after: 9 });
  subExtraFields.push(fieldCell("PROJECT / CUSTOMER (INTERNAL)", "", COL_L, W - 2 * M, { required: true })); y += FROW;
  subExtraFields.push(fieldCell("DESCRIPTION OF SERVICES", "", COL_L, W - 2 * M, { required: true })); y += FROW;
  {
    const w3 = 148;
    subExtraFields.push(fieldCell("HOURLY RATE ($)", "", COL_L, w3, { required: true }));
    subExtraFields.push(fieldCell("TRIP CHARGE ($)", "", COL_L + w3 + 14, w3, { required: true }));
    const px = COL_L + 2 * (w3 + 14);
    subExtraFields.push(fieldCell("PAYMENT TERMS", "", px, W - M - px, { required: true }));
    y += FROW;
  }
  subExtraFields.push(fieldCell("NOTES", "", COL_L, W - 2 * M, { required: false })); y += FROW;

  // ================= SIGNATURES — dedicated final page =================
  newPage();
  block("SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block(
    "By signing below, the Parties, and their respective heirs, estates, successors and assigns, agree to be legally bound to this Master Subcontractor Agreement.",
    { after: 12 },
  );

  const sigPage = pages.length;
  const leftLabelX = M; // 64
  const rightLabelX = 336;
  const leftLineEnd = 316;
  const rightLineEnd = W - M; // 548

  const fieldFor = (type: SignField["type"], labelX: number, label: string, lineEnd: number, ry: number): SignField => {
    page.drawText(label, { x: labelX, y: T(ry), size: 10, font: helv, color: INK });
    const fx = labelX + helv.widthOfTextAtSize(label, 10) + 6;
    page.drawLine({ start: { x: fx, y: T(ry) - 2 }, end: { x: lineEnd, y: T(ry) - 2 }, thickness: 0.6, color: rgb(0.55, 0.57, 0.6) });
    return {
      type,
      page: sigPage,
      x: +(fx / W).toFixed(4),
      y: +((ry - 12) / H).toFixed(4),
      w: +((lineEnd - fx) / W).toFixed(4),
      h: +(15 / H).toFixed(4),
    };
  };

  const sigBlock = (role: string, heading: string, topY: number): SignSlot => {
    page.drawText(san(heading), { x: leftLabelX, y: T(topY), size: 10.5, font: bold, color: ORANGE });
    const r1 = topY + 26; // Signature / Date
    const r2 = topY + 54; // Print Name / Title
    return {
      role,
      fields: [
        fieldFor("signature", leftLabelX, "Signature:", leftLineEnd, r1),
        fieldFor("date", rightLabelX, "Date:", rightLineEnd, r1),
        fieldFor("name", leftLabelX, "Print Name:", leftLineEnd, r2),
        fieldFor("title", rightLabelX, "Title:", rightLineEnd, r2),
      ],
    };
  };

  const subSlot = sigBlock("Subcontractor", `${subName} - Authorized Representative`, 300);
  const axusSlot = sigBlock("Axus Technologies", "Axus Technologies, LLC - Authorized Representative", 396);
  // Effective Date + the fillable party-block fields all live on page 1.
  subSlot.fields.push(effField, ...subExtraFields);

  // ---- Page numbers, tucked above the letterhead's contact strip ----
  const total = pages.length;
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: T(722), size: 7.5, font: helv, color: MUTED });
  });

  return { bytes: await pdf.save(), layout: [subSlot, axusSlot] };
}

// Axus After Hours On Call — Service Level Agreement (SLA) generator.
// Built on pdf-lib to match baapdf.ts / cocpdf.ts (same fonts, palette, logo band, and
// helpers), so the aesign backend needs no extra dependency. Produces a branded, multi-page
// SLA whose per-customer blanks (Effective Date, Client name, governing-law state) are BAKED
// IN at generation time — like the Certificate of Completion, and unlike the stored BAA
// template. Axus is the provider; the customer (Client) is the counterparty.
//
// The two signature blocks sit SIDE BY SIDE on a DEDICATED FINAL PAGE at fixed positions, so
// the layout returned here is deterministic and the frontend can hardcode a matching
// SLA_LAYOUT for the deferred "new" editor (see EnvelopeEditor). Generated on the fly by the
// apply-template / template-preview routes; there is no stored template file.
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
// Clear zone on the Axus letterhead (drawn full-page as the background of EVERY
// page): below the top-right logo band, above the bottom contact strip. Content
// baselines stay inside [TOP_SAFE, BOT_SAFE] (top-based Y) — matches quotepdf.ts.
const TOP_SAFE = 150;
const BOT_SAFE = 704;

export interface SlaData {
  company?: string; // Client legal name (baked in)
  dateLong?: string; // Effective Date (baked in), e.g. "September 15, 2026"
  state?: string; // governing-law state (defaults to Florida)
}

type Block = { t: "h" | "p" | "b"; s: string };

// Full SLA body. Client name / Effective Date / state are interpolated by build(). Commercial
// commitments (99.5% uptime; 5/10/25% credit tiers; P1 30m / P2 4h / P3 1bd response; 25%
// credit cap as sole remedy) are the Axus-approved defaults — change here to change the terms.
function buildBody(company: string, dateLong: string, state: string): Block[] {
  return [
    { t: "p", s: `This Service Level Agreement (this "SLA") is entered into as of ${dateLong} (the "Effective Date") between Axus Technologies ("Axus") and ${company} ("Client"), and is incorporated into and governed by the Master Services Agreement between the parties (the "MSA"). Capitalized terms not defined here have the meanings given in the MSA. In the event of a conflict, the MSA controls except as to the specific service levels and remedies stated in this SLA.` },

    { t: "h", s: "1. Description of Services" },
    { t: "p", s: 'Axus provides an after-hours telephone answering and on-call routing service (the "Services") consisting of: answering inbound calls to Client\'s designated number(s) during Client\'s defined after-hours coverage windows; gathering caller information via a live or automated (AI voice) attendant; triaging calls per Client-configured rules (urgent vs. non-urgent, referral / appointment handling); routing, paging, bridging, or relaying messages to Client\'s on-call personnel per the active rotation; recording calls and message handoffs and retaining records per the agreed retention schedule; and providing a web dashboard, case log, and handoff reporting.' },
    { t: "b", s: "The Services are a communications relay and answering service. They are NOT a medical, clinical, diagnostic, or emergency (911 / PSAP) service. See Section 6." },

    { t: "h", s: "2. Service Availability Commitment" },
    { t: "p", s: "2.1  Uptime. Axus will use commercially reasonable efforts to make the call-answering and routing platform available 99.5% of the time, measured monthly (the \"Monthly Uptime Percentage\"), excluding the Exclusions in Section 5. Monthly Uptime Percentage is calculated as: ((Total Minutes in the month, minus Excluded Minutes, minus Downtime Minutes) divided by (Total Minutes in the month, minus Excluded Minutes)), multiplied by 100." },
    { t: "p", s: "2.2  Downtime means a period during which the platform is unable to receive or route Client's inbound after-hours calls due to a failure within Axus's reasonable control, confirmed by Axus's monitoring or a Client report." },
    { t: "p", s: "2.3  Redundancy. The Services rely on third-party telephony carriers and cloud infrastructure. Axus maintains monitoring and failover configuration but does not warrant the availability of the public telephone network, cellular networks, or Client's own equipment or internet connection." },

    { t: "h", s: "3. Support and Response Targets" },
    { t: "p", s: "3.1  Severity targets (response, not resolution): (a) P1 - Critical (calls not being answered or routed; service down): target response 30 minutes, 24x7; target workaround/update 4 hours. (b) P2 - High (degraded routing, recording, or dashboard failure): target response 4 business hours; target workaround/update 2 business days. (c) P3 - Normal (non-urgent issue, configuration change, or question): target response 1 business day; addressed as scheduled." },
    { t: "p", s: "3.2  Contact. Support requests are submitted to the support contact designated by Axus in writing. P1 issues should be reported by phone." },
    { t: "p", s: "3.3  Response means Axus's acknowledgment and commencement of diagnosis, not resolution. The targets in this Section are goals, not guarantees, and do not constitute additional warranties." },

    { t: "h", s: "4. Service Credits" },
    { t: "p", s: "4.1  If the Monthly Uptime Percentage falls below the commitment in Section 2.1 in a given calendar month, Client may request a service credit as follows: below 99.5% and at or above 99.0%, a credit of 5% of that month's fees; below 99.0% and at or above 95.0%, a credit of 10%; below 95.0%, a credit of 25%." },
    { t: "p", s: "4.2  Claim Process. Client must request a credit in writing within thirty (30) days of the end of the affected month, including supporting detail. Approved credits are applied against future fees." },
    { t: "b", s: "4.3  Sole Remedy. Service credits are Client's sole and exclusive remedy for any failure by Axus to meet the availability commitment in this SLA. Credits in any month will not exceed 25% of that month's fees. This SLA does not expand the liability limits, caps, or disclaimers set out in the MSA." },

    { t: "h", s: "5. Exclusions" },
    { t: "p", s: "The availability commitment and service credits do not apply to any unavailability, degradation, or failure resulting from: (a) scheduled maintenance (Axus will provide advance notice; the target window is off-peak) or emergency maintenance; (b) failures of the public switched telephone network, cellular carriers, third-party telephony providers, or upstream cloud providers; (c) Client's own equipment, phone numbers, forwarding configuration, internet connectivity, or personnel (including on-call staff who are unreachable, do not answer, or have not updated the rotation); (d) incorrect or incomplete configuration, routing rules, or contact data supplied or maintained by Client; (e) force majeure events (Section 7); (f) Client's breach of the MSA or use of the Services outside their intended scope; or (g) suspension or termination in accordance with the MSA." },

    { t: "h", s: "6. Scope Limitations and Disclaimers" },
    { t: "b", s: "These provisions are material to Axus's agreement to provide the Services." },
    { t: "p", s: "6.1  Not an Emergency Service. The Services are not a substitute for 911 or any emergency medical, fire, police, or dispatch service. Callers experiencing a medical emergency must be directed to call 911 or go to the nearest emergency department. Client is responsible for ensuring its greetings, prompts, and instructions communicate this to callers." },
    { t: "p", s: "6.2  Not Medical Advice. Axus and its attendants (human or AI) do not provide medical, clinical, diagnostic, or treatment advice, and do not exercise clinical judgment. Triage is limited to applying Client's own configured routing rules. All clinical decisions remain solely with Client's licensed personnel." },
    { t: "p", s: "6.3  Message Relay / Best Effort. Axus's role is to answer, capture, and relay messages and to attempt to reach Client's designated on-call personnel using the contact methods and rotation Client provides. Axus does not guarantee that any particular message will be delivered to, received by, acknowledged by, or acted upon by Client's personnel, whose availability and responsiveness are outside Axus's control." },
    { t: "p", s: "6.4  Third-Party Dependencies. The Services depend on telephony carriers, cellular networks, and cloud providers. Interruptions, delays, or quality issues originating with those third parties are outside Axus's control." },
    { t: "p", s: "6.5  Client Responsibilities. Client is responsible for maintaining an accurate on-call roster and rotation; ensuring designated personnel are reachable and respond; keeping caller-facing emergency instructions current; and promptly reporting any issue with the Services." },
    { t: "p", s: "6.6  No Additional Warranties. Except as expressly stated in the MSA, the Services are provided \"AS IS.\" This SLA does not create any warranty beyond those in the MSA, and all limitations of liability and disclaimers in the MSA apply fully to this SLA." },

    { t: "h", s: "7. Force Majeure" },
    { t: "p", s: "Neither party is liable for any failure or delay caused by events beyond its reasonable control, including acts of God, natural disasters, hurricanes, power or telecommunications failures, carrier outages, cyberattacks, labor disputes, or governmental action." },

    { t: "h", s: "8. Term and Review" },
    { t: "p", s: `This SLA is effective as of the Effective Date and continues for so long as the MSA remains in effect. The parties may review and adjust this SLA annually or upon material change to the Services, by written amendment signed by both parties. This SLA is governed by the laws of the State of ${state}, without regard to conflict-of-laws principles, except to the extent preempted by federal law.` },
  ];
}

export async function generateSlaPdf(
  d: SlaData = {},
  opts: { assetsDir?: string } = {},
): Promise<{ bytes: Uint8Array; layout: SignSlot[] }> {
  const assetsDir = opts.assetsDir ?? join(process.cwd(), "assets");
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Axus letterhead (corner banner + logo + faint X watermark + footer) laid down
  // as a full-page background on every page, matching the Quote / Certificate of
  // Completion. Sized to fill the whole portrait page exactly.
  let letter: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null;
  try {
    letter = await pdf.embedJpg(await readFile(join(assetsDir, "letterhead.jpg")));
  } catch {
    /* letterhead optional */
  }

  const company = d.company?.trim() || "the Client";
  const dateLong = d.dateLong?.trim() || "____________________";
  const state = d.state?.trim() || "Florida";

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // baseline of the next line, as a distance from the top of the page
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
    // Full-page letterhead background first, exactly filling the portrait page.
    if (letter) page.drawImage(letter, { x: 0, y: 0, width: W, height: H });
    y = TOP_SAFE; // first baseline sits below the letterhead's top logo band
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
    for (const ln of wrap(text, font, size, W - 2 * M - indent)) {
      ensure(lead);
      page.drawText(ln, { x: M + indent, y: T(y), size, font, color: o.color ?? INK });
      y += lead;
    }
    y += o.after ?? 5;
  };

  // ---- Page 1: title (letterhead already carries the logo top-right) ----
  newPage();
  block("Service Level Agreement", { size: 19, font: bold, lead: 23, after: 2 });
  block("Axus After Hours On Call", { size: 9, color: MUTED, lead: 12, after: 10 });

  // ---- Body ----
  for (const b of buildBody(company, dateLong, state)) {
    if (b.t === "h") {
      ensure(46);
      y += 8;
      block(b.s.toUpperCase(), { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
    } else if (b.t === "b") {
      block(b.s, { font: bold });
    } else {
      block(b.s);
    }
  }

  // ================= SIGNATURES — dedicated final page, SOW-style blocks =================
  // Two parties STACKED vertically, each with a heading and a compact two-row block:
  //   Signature: ______   Date: ______
  //   Print Name: _____   Title: ______
  // Mirrors the Axus SOW signature block so every Axus agreement signs the same way. A fresh
  // page keeps the positions (and the returned layout / frontend SLA_LAYOUT) deterministic.
  newPage();
  block("9. SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block("IN WITNESS WHEREOF, the parties have caused this SLA to be executed by their duly authorized representatives as of the Effective Date.", { after: 12 });

  const sigPage = pages.length; // 1-based page number of this (final) page
  const leftLabelX = M; // 64 — Signature / Print Name column
  const rightLabelX = 336; // Date / Title column
  const leftLineEnd = 316; // end of the Signature / Print Name lines
  const rightLineEnd = W - M; // 548 — end of the Date / Title lines

  const fieldFor = (
    type: SignField["type"],
    labelX: number,
    label: string,
    lineEnd: number,
    ry: number,
  ): SignField => {
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

  // Each party: a bold heading, then Signature/Date on one row and Print Name/Title on the next.
  const sigBlock = (role: string, heading: string, topY: number): SignSlot => {
    page.drawText(heading, { x: leftLabelX, y: T(topY), size: 10.5, font: bold, color: ORANGE });
    const r1 = topY + 26; // Signature / Date
    const r2 = topY + 54; // Print Name / Title
    const fields: SignField[] = [
      fieldFor("signature", leftLabelX, "Signature:", leftLineEnd, r1),
      fieldFor("date", rightLabelX, "Date:", rightLineEnd, r1),
      fieldFor("name", leftLabelX, "Print Name:", leftLineEnd, r2),
      fieldFor("title", rightLabelX, "Title:", rightLineEnd, r2),
    ];
    return { role, fields };
  };

  const clientName = company === "the Client" ? "Client" : company;
  const clientSlot = sigBlock("Client", `${clientName} - Authorized Representative`, 300);
  const axusSlot = sigBlock("Axus Technologies", "Axus Technologies - Authorized Representative", 396);

  // ---- Page numbers, tucked just above the letterhead's contact strip ----
  // (The letterhead footer already carries the Axus address / phone / web.)
  const total = pages.length;
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: T(722), size: 7.5, font: helv, color: MUTED });
  });

  return { bytes: await pdf.save(), layout: [clientSlot, axusSlot] };
}

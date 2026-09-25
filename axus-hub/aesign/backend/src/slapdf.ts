// Axus After Hours On-Call — Service Level Agreement (SLA) generator.
// Generated on the Axus letterhead with per-customer values (Effective Date, Client
// legal name) baked in. Two signer blocks (SOW-style: Signature/Date then Print
// Name/Title) sit stacked on a DEDICATED FINAL PAGE, so the returned layout is
// deterministic and the frontend can hardcode a matching SLA_LAYOUT.
// Body text = the Hardened Form v1.2 (verbatim); edit SLA_BLOCKS to change terms.
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
// Clear zone on the Axus letterhead (drawn full-page on every page).
const TOP_SAFE = 150;
const BOT_SAFE = 704;

export interface SlaData {
  company?: string; // Client / Customer legal name (baked in)
  dateLong?: string; // Effective Date (baked in), e.g. "September 25, 2026"
  state?: string; // accepted for compatibility; governing law is Florida in the body
}

type Block = { t: "h" | "p"; s: string };

const SLA_BLOCKS: Block[] = [
  { t: "p", s: "This Service Level Agreement (this \u201cSLA\u201d) is entered into as of [EFFECTIVE DATE] (the \u201cEffective Date\u201d) by and between Axus Technologies, LLC, a Florida limited liability company (\u201cAxus\u201d), and [CLIENT LEGAL NAME] (\u201cClient\u201d). This SLA is incorporated into and governed by the Master Services Agreement (or other applicable master, enterprise, or services agreement) between the parties (the \u201cMSA\u201d). Capitalized terms not defined in this SLA have the meanings given in the MSA. If no MSA is in effect, this SLA is governed by Axus\u2019s then-current standard services terms as made available to Client in writing or in the administrative portal (which shall be deemed the \u201cMSA\u201d for purposes of this SLA), and Florida law applies as provided in Section 11.3." },
  { t: "p", s: "Relationship of documents. In the event of a conflict, the MSA controls except as to the specific service levels, measurement methodology, exclusions, and service-credit remedies expressly stated in this SLA. If Client is a HIPAA Covered Entity or Business Associate and Axus creates, receives, maintains, or transmits Protected Health Information in connection with the Services, the parties\u2019 Business Associate Agreement (the \u201cBAA\u201d) controls solely with respect to PHI and HIPAA compliance. Commercial terms\u2014including fees, payment, warranties, indemnities, limitations of liability, and insurance\u2014remain governed by the MSA to the maximum extent permitted by law." },
  { t: "h", s: "1.  DEFINITIONS" },
  { t: "p", s: "1.1  \u201cServices\u201d means the after-hours telephone answering and on-call routing service described in Section 2, as specified in the applicable order, statement of work, or service schedule." },
  { t: "p", s: "1.2  \u201cCoverage Windows\u201d means the after-hours, weekend, holiday, or other periods during which Client has purchased answering and routing coverage, as configured in the Axus administrative tools or written service schedule. Unless expressly purchased as 24\u00d77 coverage, the Services are not a continuous around-the-clock live answering commitment outside Coverage Windows." },
  { t: "p", s: "1.3  \u201cAxus-Controlled Platform\u201d means the call-answering, recording (if enabled), routing, logging, and dashboard systems that Axus operates and can reasonably control. It does not include the public switched telephone network (\u201cPSTN\u201d), cellular networks, Internet or DNS providers, Client systems, caller devices, or third-party messaging, paging, or cloud infrastructure that Axus does not operate." },
  { t: "p", s: "1.4  \u201cDowntime\u201d means a continuous period during which the Axus-Controlled Platform is materially unable to receive or route Client\u2019s inbound after-hours calls because of a failure within Axus\u2019s reasonable control, confirmed by Axus monitoring or by reasonably verifiable Client evidence accepted by Axus. A failed, delayed, blocked, screened, misrouted, unanswered, or individually mishandled call does not by itself establish Downtime." },
  { t: "p", s: "1.5  \u201cTotal Minutes\u201d means the total number of minutes in the applicable calendar month. \u201cExcluded Minutes\u201d means minutes attributable to the exclusions in Section 6. \u201cDowntime Minutes\u201d means minutes of confirmed Downtime that are not Excluded Minutes." },
  { t: "p", s: "1.6  \u201cMonthly Uptime Percentage\u201d means ((Total Minutes \u2212 Excluded Minutes \u2212 Downtime Minutes) / (Total Minutes \u2212 Excluded Minutes)) \u00d7 100, calculated to two decimal places." },
  { t: "p", s: "1.7  \u201cBusiness Hours\u201d and \u201cBusiness Day\u201d mean 8:00 a.m. to 5:00 p.m. Eastern Time, Monday through Friday, excluding New Year\u2019s Day, Memorial Day, Independence Day, Labor Day, Thanksgiving Day, and Christmas Day, and any other day Axus designates on at least ten (10) days\u2019 written notice. Business Hours and Business Days govern only the P2 and P3 support targets in Section 4; they do not limit or reduce the Coverage Windows Client has purchased, which include holidays and weekends to the extent so configured." },
  { t: "p", s: "1.8  \u201cAffected Service Fees\u201d means the recurring fees actually paid or payable for the Services covered by this SLA for the affected calendar month, excluding one-time fees, professional-services fees, pass-through carrier charges, overage charges, taxes, and fees for other Axus offerings." },
  { t: "h", s: "2.  DESCRIPTION OF SERVICES" },
  { t: "p", s: "Axus provides an after-hours telephone answering and on-call routing service consisting of: answering inbound calls to Client\u2019s designated number(s) during Coverage Windows; gathering caller information through live attendants and/or automated technologies, including AI voice systems; applying Client-configured routing and escalation rules; routing, paging, bridging, or relaying messages to Client\u2019s designated personnel; recording, transcribing, summarizing, and logging calls or message handoffs when configured; and providing related dashboards, case logs, reports, and administrative tools." },
  { t: "p", s: "The Services are a communications relay and answering service. They are not a medical, clinical, diagnostic, emergency-dispatch, public-safety answering point (PSAP), or 911 service. Axus does not independently diagnose, treat, determine medical urgency, triage beyond applying Client-supplied rules, or make clinical decisions." },
  { t: "p", s: "This SLA applies only to the Services described in this Section 2. Other Axus offerings (including managed IT, vendor enterprise-agreement program services, or professional services) are governed by their own terms and are not covered by the availability commitment in this SLA unless expressly added in a signed writing." },
  { t: "h", s: "3.  SERVICE AVAILABILITY COMMITMENT" },
  { t: "p", s: "3.1  Uptime. Axus will use commercially reasonable efforts to make the Axus-Controlled Platform available at a Monthly Uptime Percentage of 99.5%, excluding the events in Section 6." },
  { t: "p", s: "3.2  Measurement. Axus\u2019s monitoring and logs are the primary source for measuring availability. Client may submit reasonably detailed contrary evidence within the credit-claim period. Isolated call-level events, carrier call-setup failures, and spam or robocall mitigation do not constitute Downtime." },
  { t: "p", s: "3.3  Third-Party Infrastructure. The Services depend on telecommunications carriers, the PSTN and cellular networks, Internet connectivity, DNS, cloud infrastructure, messaging and paging providers, software vendors, and other third parties. Axus may maintain monitoring, redundancy, or failover where commercially reasonable, but does not warrant third-party availability, call quality, delivery latency, or spam-labeling outcomes." },
  { t: "p", s: "3.4  Maintenance. Scheduled or emergency maintenance is excluded from the availability commitment. Axus will use commercially reasonable efforts to schedule maintenance outside Client\u2019s Coverage Windows where practicable and to give Client at least forty-eight (48) hours\u2019 advance notice of scheduled maintenance that is reasonably expected to affect the Services, except that emergency maintenance may be performed with little or no notice when reasonably necessary to protect the Services, users, or PHI." },
  { t: "h", s: "4.  SUPPORT AND RESPONSE TARGETS" },
  { t: "p", s: "4.1  Severity targets (response, not resolution). The following are operational goals, not guarantees, additional warranties, or independent grounds for termination or damages." },
  { t: "p", s: "P1 \u2013 Critical (Axus-Controlled Platform materially unavailable for inbound after-hours call receipt or routing): target response of thirty (30) minutes, 24\u00d77; target workaround or status update within four (4) hours." },
  { t: "p", s: "P2 \u2013 High (material degradation of routing, recording, or dashboard functionality, without P1 unavailability): target response of four (4) Business Hours; target workaround or status update within two (2) Business Days." },
  { t: "p", s: "P3 \u2013 Normal (non-urgent defect, configuration change, request, or question): target response of one (1) Business Day; addressed as scheduled." },
  { t: "p", s: "4.2  Contact. Support requests must be submitted through the support method designated by Axus. P1 issues should be reported by telephone using the designated emergency support number provided to Client in writing or in the administrative portal." },
  { t: "p", s: "4.3  Response. \u201cResponse\u201d means acknowledgment and commencement of diagnosis, not restoration, workaround, or final resolution." },
  { t: "h", s: "5.  SERVICE CREDITS" },
  { t: "p", s: "5.1  Credits. If the Monthly Uptime Percentage falls below 99.5% in a calendar month, Client may request a service credit against Affected Service Fees for that month, as follows:" },
  { t: "p", s: "Below 99.50% but at or above 99.00%: five percent (5%) of that month\u2019s Affected Service Fees." },
  { t: "p", s: "Below 99.00% but at or above 95.00%: ten percent (10%) of that month\u2019s Affected Service Fees." },
  { t: "p", s: "Below 95.00%: twenty-five percent (25%) of that month\u2019s Affected Service Fees." },
  { t: "p", s: "5.2  Claim process. Client must request a credit in writing within thirty (30) days after the end of the affected month and provide reasonable supporting detail, including dates, times, and a description of the alleged unavailability. Untimely claims are waived. Axus will review each timely claim and confirm or deny it in writing within thirty (30) days after receipt; approved credits will be applied to the next invoice issued after approval." },
  { t: "p", s: "5.3  Conditions. Credits are available only if Client is current on undisputed fees and not in material breach of the MSA or this SLA at the time of the claimed Downtime and at the time of the request. Credits are applied against future fees, have no cash value, are not refundable except where required by law, and may not be aggregated with other credits to exceed twenty-five percent (25%) of the affected month\u2019s Affected Service Fees." },
  { t: "p", s: "5.4  Sole remedy. Service credits are Client\u2019s sole and exclusive remedy for any failure to meet the availability commitment or the support targets in this SLA. Credits do not expand any limitation, exclusion, indemnity, disclaimer, or liability cap in the MSA, and do not create a refund right or a claim for direct, incidental, or consequential damages. Except as provided in the following sentence, a failure to meet the availability commitment does not create a termination right. If the Monthly Uptime Percentage falls below 95.00% in any three (3) calendar months within a rolling twelve (12) month period, Client may terminate the affected Services on thirty (30) days\u2019 written notice delivered within sixty (60) days after the end of the third such month, without early-termination fees, as its sole additional remedy." },
  { t: "h", s: "6.  EXCLUSIONS" },
  { t: "p", s: "The availability commitment, support targets, and service credits do not apply to any unavailability, degradation, delay, misrouting, or call or message failure caused by or attributable to:" },
  { t: "p", s: "(a) scheduled or emergency maintenance;" },
  { t: "p", s: "(b) PSTN, cellular, Internet, DNS, carrier, upstream telephony, messaging, paging, SMS, email, or cloud-provider failures, latency, filtering, or labeling;" },
  { t: "p", s: "(c) caller devices, carrier spam labeling, robocall mitigation, call blocking, call screening, voicemail behavior, caller settings, or failures occurring before a call reaches the Axus-Controlled Platform;" },
  { t: "p", s: "(d) Client equipment, networks, phone numbers, forwarding, PBX, SIP trunks, Internet connectivity, or systems;" },
  { t: "p", s: "(e) unreachable, incorrect, incomplete, or nonresponsive Client personnel or destinations;" },
  { t: "p", s: "(f) inaccurate, incomplete, stale, unauthorized, or untested Client configuration, routing, schedules, prompts, greetings, escalation rules, on-call rosters, or contact information;" },
  { t: "p", s: "(g) Client-requested changes, pilots, tests, or custom workflows;" },
  { t: "p", s: "(h) force majeure events described in Section 10;" },
  { t: "p", s: "(i) Client breach, misuse, unreasonable configuration, or use outside the intended scope of a communications relay service;" },
  { t: "p", s: "(j) suspension or termination under the MSA; or" },
  { t: "p", s: "(k) security, fraud-prevention, or abuse-prevention measures reasonably implemented to protect the Services, Axus, Client, callers, or other customers." },
  { t: "h", s: "7.  SCOPE LIMITATIONS AND DISCLAIMERS" },
  { t: "p", s: "7.1  Not an emergency service. The Services are not a substitute for 911, emergency medical services, fire, police, poison control, crisis-response, suicide-prevention, or emergency dispatch. Client is solely responsible for caller-facing emergency instructions, including any instruction to hang up and dial 911. Axus has no duty to independently determine whether a caller is experiencing an emergency, to remain on the line with an emergency caller, or to dispatch emergency responders, unless expressly agreed in a separate signed service description that specifically assumes that duty." },
  { t: "p", s: "7.2  No medical advice or clinical judgment. Axus personnel and automated systems do not provide medical, clinical, diagnostic, or treatment advice and do not exercise clinical judgment. Any \u201ctriage,\u201d classification, or urgency tagging is limited to applying Client-supplied rules and scripts. Clinical decisions, medical necessity determinations, and the standard of care owed to patients remain solely with Client\u2019s licensed personnel." },
  { t: "p", s: "7.3  Message relay; best efforts. Axus will use commercially reasonable efforts to capture and relay messages and to attempt contact using Client-provided methods and rotations. Axus does not guarantee that a particular message will be delivered, received, acknowledged, understood, or acted upon, or that a particular recipient will be reachable at any given time." },
  { t: "p", s: "7.4  Automated and AI-assisted functions. Client authorizes Axus to use automated systems, including AI-assisted voice, transcription, summarization, classification, and routing tools, as configured for the Services, including with human review where Axus determines it is appropriate. Automated outputs may contain errors, omissions, delays, or misclassifications and must not be relied upon as medical advice or as the sole mechanism for emergency response. Axus remains responsible for its contractual obligations under the MSA and this SLA but does not warrant that automated output will be error-free, complete, or clinically appropriate." },
  { t: "p", s: "7.5  Client configuration and testing. Client is responsible for reviewing and approving greetings, prompts, schedules, routing rules, escalation paths, destinations, on-call rosters, emergency instructions, recording settings, and other Client-specific configurations; promptly communicating changes; ensuring designated personnel are reachable; and periodically testing its call flows and escalation paths. Client must promptly report suspected defects or misrouting." },
  { t: "p", s: "7.6  Recording, transcription, and two-party consent. Where recording, monitoring, transcription, or automated processing is enabled, Client is responsible for determining and implementing any notices, consents, or restrictions required by applicable law for Client\u2019s intended use and for the jurisdictions in which callers and Client personnel are located. Client acknowledges that Florida (Fla. Stat. \u00a7 934.03) and certain other states require the consent of all parties to a recorded conversation. Unless Client instructs otherwise in writing and accepts the resulting risk, Client shall include, and hereby authorizes Axus to play, a clear call-recording or monitoring notice in the applicable greeting. Client will not instruct Axus to use the Services in a manner that violates applicable privacy, recording, wiretap, or communications law. Client is responsible for notices and consents applicable to its own workforce and on-call personnel." },
  { t: "p", s: "7.7  TCPA, text messaging, and outbound contact. If Client configures paging, SMS, email, or outbound voice contact, Client represents that it has provided Axus only numbers and addresses that Client is authorized to use for that purpose and that Client is responsible for compliance with the Telephone Consumer Protection Act, the Telemarketing Sales Rule, CAN-SPAM, and analogous state laws. Axus is not Client\u2019s telemarketer and does not warrant deliverability of SMS, pages, or email." },
  { t: "p", s: "7.8  Channel and carrier risk. Voice over the PSTN or cellular networks, unencrypted SMS, pages, and standard email have inherent security and reliability limitations. By selecting a contact method in the configuration tools, Client authorizes use of that method for message content, which may include PHI, and accepts those inherent limitations. Axus\u2019s security obligations apply to the Axus-Controlled Platform and not to carrier networks Axus does not operate." },
  { t: "p", s: "7.9  Security and access. Client is responsible for safeguarding its credentials, restricting administrative access to authorized personnel, promptly disabling former users, and notifying Axus of suspected credential compromise. Axus may take reasonable protective action, including temporary restriction of access, when necessary to protect the Services, provided any handling of PHI remains subject to the BAA and applicable law." },
  { t: "p", s: "7.10  No additional warranties. Except as expressly stated in the MSA, the Services are provided \u201cAS IS\u201d and \u201cAS AVAILABLE.\u201d This SLA creates no warranty beyond the MSA. All limitations of liability, warranty disclaimers, exclusions of damages, indemnification provisions, and other risk allocations in the MSA apply to this SLA and to any claim arising out of the Services." },
  { t: "h", s: "8.  DATA, RECORDS, AND RETENTION" },
  { t: "p", s: "Call recordings, transcripts, message logs, and related records will be retained only as configured for the applicable Service or as otherwise agreed in writing. Client is responsible for identifying any legally required retention period applicable to Client, including medical-record, payor, and professional-board requirements. Axus may delete records after the applicable retention period, subject to the BAA and applicable law, including ordinary backup and archival cycles. Client should export records it is required to preserve before expiration of the configured retention period. Axus is not Client\u2019s official medical-record custodian unless a separate signed writing expressly so states. Upon termination of the Services, return or destruction of records containing PHI is governed by the BAA." },
  { t: "h", s: "9.  CLIENT RESPONSIBILITY FOR CLINICAL AND OPERATIONAL OUTCOMES" },
  { t: "p", s: "Client remains solely responsible for the adequacy of its on-call coverage, the qualifications and availability of its designated personnel, the medical and operational content of its scripts and rules, timely updates to rosters and schedules, and all acts and omissions of its workforce and medical staff in responding to relayed messages. Nothing in this SLA shifts to Axus any duty Client owes to patients, callers, payors, or regulators." },
  { t: "h", s: "10.  FORCE MAJEURE" },
  { t: "p", s: "Neither party is liable for failure or delay caused by events beyond its reasonable control, including natural disasters, hurricanes, fire, epidemic, utility or telecommunications failures, carrier outages, widespread Internet failures, cyberattacks not caused by the affected party\u2019s failure to use legally required or contractually required safeguards, labor disputes, civil unrest, governmental action, or other force majeure events. The affected party will use commercially reasonable efforts to mitigate the impact and resume performance. Force majeure does not excuse Client\u2019s obligation to pay fees for Services actually provided." },
  { t: "h", s: "11.  TERM, REVIEW, AND GOVERNING LAW" },
  { t: "p", s: "11.1  Term. This SLA is effective as of the Effective Date and continues for so long as the Services are provided under the MSA, unless earlier terminated in accordance with the MSA." },
  { t: "p", s: "11.2  Changes. The parties may review or amend this SLA by written agreement signed by both parties. Axus may make non-material operational changes (including to support contact methods, measurement tooling, and maintenance windows) that do not reduce the availability commitment, support targets, or service-credit remedies stated in this SLA. Any reduction of those commitments or remedies requires Client\u2019s written agreement or the amendment procedures in the MSA." },
  { t: "p", s: "11.3  Governing law. This SLA is governed by the governing-law and venue provisions of the MSA. If the MSA is silent, this SLA is governed by the laws of the State of Florida, without regard to conflict-of-laws principles, except to the extent preempted by federal law." },
  { t: "p", s: "11.4  Miscellaneous. This SLA may be executed in counterparts and by electronic signature, each of which is deemed an original. Headings are for convenience only. If any provision is held unenforceable, the remainder continues in effect. This SLA does not create any third-party beneficiary rights." },
];

// Fill the per-customer placeholders in the static body text.
function buildBody(company: string, dateLong: string): Block[] {
  return SLA_BLOCKS.map((b) => ({
    t: b.t,
    s: b.s.replace(/\[EFFECTIVE DATE\]/g, dateLong).replace(/\[CLIENT LEGAL NAME\]/g, company),
  }));
}

export async function generateSlaPdf(
  d: SlaData = {},
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

  const company = d.company?.trim() || "the Client";
  const dateLong = d.dateLong?.trim() || "____________________";

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // baseline of the next line, measured from the top of the page
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

  // The standard Helvetica font is WinAnsi/CP1252-encoded; normalize the few glyphs
  // outside that set (e.g. the U+2212 minus sign in the uptime formula) to safe equivalents.
  const san = (s: string) => s.replace(/−/g, "-");

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

  // ---- Page 1: title (letterhead already carries the logo top-right) ----
  newPage();
  block("Service Level Agreement", { size: 19, font: bold, lead: 23, after: 2 });
  block("After-Hours On-Call Answering and Routing Services", { size: 9, color: MUTED, lead: 12, after: 1 });
  block("Hardened Form  |  Version 1.2  |  September 2026  |  Doc. No. 2026-AXUS-SLA-001.2", { size: 8, color: MUTED, lead: 11, after: 10 });

  // ---- Body ----
  for (const b of buildBody(company, dateLong)) {
    if (b.t === "h") {
      ensure(46);
      y += 8;
      block(b.s.toUpperCase(), { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
    } else {
      block(b.s);
    }
  }

  // ================= SIGNATURES — dedicated final page, SOW-style blocks =================
  // Two parties STACKED vertically, each with a heading and Signature/Date + Print Name/Title
  // rows. A fresh page keeps positions (and the frontend layout) deterministic.
  newPage();
  block("12. SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block("IN WITNESS WHEREOF, the parties have caused this SLA to be executed by their duly authorized representatives as of the Effective Date.", { after: 12 });

  const sigPage = pages.length;
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

  const sigBlock = (role: string, heading: string, topY: number): SignSlot => {
    page.drawText(san(heading), { x: leftLabelX, y: T(topY), size: 10.5, font: bold, color: ORANGE });
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
  const party1Slot = sigBlock("Client", `${clientName} - Authorized Representative`, 300);
  const party2Slot = sigBlock("Axus Technologies", "Axus Technologies, LLC - Authorized Representative", 396);

  // ---- Page numbers, tucked above the letterhead's contact strip ----
  const total = pages.length;
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: T(722), size: 7.5, font: helv, color: MUTED });
  });

  return { bytes: await pdf.save(), layout: [party1Slot, party2Slot] };
}

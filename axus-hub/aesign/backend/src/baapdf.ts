// Axus Business Associate Agreement (HIPAA/HITECH) generator.
// Generated on the Axus letterhead with per-customer values (Effective Date, Client
// legal name) baked in. Two signer blocks (SOW-style: Signature/Date then Print
// Name/Title) sit stacked on a DEDICATED FINAL PAGE, so the returned layout is
// deterministic and the frontend can hardcode a matching BAA_LAYOUT.
// Body text = the Hardened Form v1.2 (verbatim); edit BAA_BLOCKS to change terms.
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

export interface BaaData {
  company?: string; // Client / Customer legal name (baked in)
  dateLong?: string; // Effective Date (baked in), e.g. "September 25, 2026"
  state?: string; // accepted for compatibility; governing law is Florida in the body
}

type Block = { t: "h" | "p"; s: string };

const BAA_BLOCKS: Block[] = [
  { t: "p", s: "This Business Associate Agreement (this \u201cAgreement\u201d) is entered into as of [EFFECTIVE DATE] (the \u201cEffective Date\u201d) by and between [CLIENT LEGAL NAME] (\u201cCustomer\u201d) and Axus Technologies, LLC (\u201cBusiness Associate\u201d). Customer and Business Associate are each a \u201cParty\u201d and together the \u201cParties.\u201d" },
  { t: "h", s: "RECITALS" },
  { t: "p", s: "WHEREAS, Business Associate provides or may provide communications, managed technology, answering, routing, voice, messaging, recording, transcription, automation, and related services to or on behalf of Customer, and in connection with those services may create, receive, maintain, or transmit Protected Health Information (\u201cPHI\u201d);" },
  { t: "p", s: "WHEREAS, Customer is a Covered Entity and/or a Business Associate under HIPAA, and the Parties intend to protect PHI in compliance with the Health Insurance Portability and Accountability Act of 1996, the Health Information Technology for Economic and Clinical Health Act, and their implementing regulations, each as amended (collectively, \u201cHIPAA\u201d);" },
  { t: "p", s: "NOW, THEREFORE, the Parties agree as follows." },
  { t: "h", s: "1.  DEFINITIONS AND STATUS" },
  { t: "p", s: "1.1  Catch-all. Capitalized terms not otherwise defined in this Agreement have the meanings assigned by the HIPAA Privacy, Security, Breach Notification, and Enforcement Rules at 45 C.F.R. Parts 160 and 164, as amended, including \u201cBreach,\u201d \u201cUnsecured PHI,\u201d \u201cSecurity Incident,\u201d \u201cDesignated Record Set,\u201d \u201cRequired by Law,\u201d and \u201cSecretary.\u201d" },
  { t: "p", s: "1.2  PHI. \u201cPHI\u201d is limited to Protected Health Information that Business Associate creates, receives, maintains, or transmits for or on behalf of Customer. Depending on the Services, PHI may include caller information, call recordings, voicemail, transcripts, summaries, message content, call metadata, routing records, case notes, and related service records to the extent such information constitutes PHI under HIPAA." },
  { t: "p", s: "1.3  Customer status. If Customer is itself a Covered Entity, this Agreement is a business associate agreement under 45 C.F.R. \u00a7 164.504(e) and \u00a7 164.314(a). If Customer is itself a Business Associate of a Covered Entity, then: (a) this Agreement is a written subcontractor business associate agreement under 45 C.F.R. \u00a7\u00a7 164.502(e)(1)(ii), 164.504(e)(5), 164.308(b)(2), and 164.314(a)(2)(iii); (b) references to Customer\u2019s HIPAA obligations include the obligations Customer owes as a Business Associate; and (c) Customer represents that it is authorized to permit Business Associate to create, receive, maintain, or transmit the PHI described in this Agreement. References in this Agreement to Customer as a Covered Entity shall be read, where Customer is a Business Associate, as references to Customer in that capacity." },
  { t: "p", s: "1.4  Services. \u201cServices\u201d means the services described in the applicable master services agreement, enterprise agreement, order, statement of work, service schedule, or service level agreement between the Parties (collectively, the \u201cService Agreement\u201d)." },
  { t: "p", s: "1.5  Discovery. \u201cDiscovery\u201d of a Breach has the meaning given in 45 C.F.R. \u00a7 164.410: the first day on which the Breach is known to Business Associate, or would have been known by exercising reasonable diligence. Knowledge of a workforce member or agent, other than the person committing the Breach, is imputed in accordance with that section." },
  { t: "h", s: "2.  OBLIGATIONS AND ACTIVITIES OF BUSINESS ASSOCIATE" },
  { t: "p", s: "2.1  Permitted use. Business Associate shall not use or disclose PHI except as permitted or required by this Agreement or as Required by Law. Business Associate shall not use or disclose PHI in a manner that would violate Subpart E of 45 C.F.R. Part 164 if done by Customer, except for the uses and disclosures expressly permitted by Sections 3.4 and 3.5. To the extent the Service Agreement describes the Services, it informs the scope of the uses and disclosures permitted under Section 3.1 but does not expand the uses and disclosures permitted by this Agreement." },
  { t: "p", s: "2.2  Safeguards. Business Associate shall use appropriate safeguards and comply with Subpart C of 45 C.F.R. Part 164 with respect to electronic PHI, including administrative, physical, and technical safeguards reasonably and appropriately designed to protect the confidentiality, integrity, and availability of electronic PHI it creates, receives, maintains, or transmits on the systems it operates." },
  { t: "p", s: "2.3  Mitigation. Business Associate shall take reasonable steps to mitigate, to the extent practicable, harmful effects known to Business Associate resulting from a use or disclosure of PHI in violation of this Agreement." },
  { t: "p", s: "2.4  Reporting of unauthorized activity and Breaches. Business Associate shall report to Customer any use or disclosure of PHI not provided for by this Agreement, any Security Incident of which it becomes aware (other than Unsuccessful Security Incidents addressed in Section 2.5), and any Breach of Unsecured PHI of which it becomes aware, without unreasonable delay and in no event later than ten (10) calendar days after Discovery, or such shorter period as is required by applicable law (including 45 C.F.R. \u00a7 164.410 and, where applicable, Fla. Stat. \u00a7 501.171(6)). Business Associate shall provide the information required by 45 C.F.R. \u00a7 164.410(c) to the extent then known and may supplement its report as additional information becomes available." },
  { t: "p", s: "2.5  Unsuccessful Security Incidents. The Parties acknowledge that routine unsuccessful Security Incidents\u2014including pings, automated scans, blocked probes, unsuccessful authentication attempts, firewall-denied traffic, and similar events that do not result in unauthorized access, use, disclosure, modification, or destruction of PHI or material interference with system operations\u2014occur regularly. Such events are \u201cUnsuccessful Security Incidents.\u201d This Section 2.5 constitutes standing notice of Unsuccessful Security Incidents, and no additional individual notice is required unless otherwise required by law." },
  { t: "p", s: "2.6  Subcontractors. In accordance with 45 C.F.R. \u00a7\u00a7 164.502(e)(1)(ii), 164.504(e)(5), and 164.308(b)(2), Business Associate shall ensure that each subcontractor that creates, receives, maintains, or transmits PHI on its behalf agrees in writing to restrictions and conditions that satisfy HIPAA and are no less protective of PHI than the applicable obligations imposed on Business Associate by this Agreement. If Business Associate knows of a pattern of activity or practice of a subcontractor that constitutes a material breach of the subcontractor\u2019s obligations, Business Associate shall take reasonable steps to cure the breach or end the violation and, if unsuccessful, terminate the arrangement if feasible. Telecommunications carriers, Internet providers, and similar utilities that do not create, receive, maintain, or transmit PHI on behalf of Business Associate in a business-associate capacity are not required to execute a business associate agreement solely by reason of network transit." },
  { t: "p", s: "2.7  Access. To the extent Business Associate maintains PHI in a Designated Record Set, Business Associate shall make such PHI available to Customer, or as directed by Customer to an Individual, as necessary to satisfy Customer\u2019s obligations under 45 C.F.R. \u00a7 164.524, within fifteen (15) business days after a written request, or sooner if reasonably required for Customer to meet a legally mandated deadline that is identified in the request, unless a different period is required by applicable law and reasonably communicated to Business Associate. The Parties acknowledge that ordinary answering-service call recordings, message logs, and routing records may not constitute a Designated Record Set, and Business Associate maintains a Designated Record Set only to the extent the Services are configured or required by law to do so." },
  { t: "p", s: "2.8  Amendment and accounting. To the extent Business Associate maintains PHI in a Designated Record Set, Business Associate shall make amendments as directed or agreed to by Customer under 45 C.F.R. \u00a7 164.526. Business Associate shall maintain and make available information required for an accounting of disclosures under 45 C.F.R. \u00a7 164.528, limited to disclosures that are required to be accounted for under that section and to the extent applicable to PHI actually maintained by Business Associate." },
  { t: "p", s: "2.9  Individual requests received by Business Associate. If Business Associate receives a request from an Individual for access, amendment, restriction, or an accounting relating to PHI, Business Associate shall, unless expressly engaged in writing to respond on Customer\u2019s behalf, promptly forward the request to Customer and shall not independently determine or fulfill the Individual\u2019s request." },
  { t: "p", s: "2.10  Customer functions. To the extent Business Associate is expressly engaged in a signed writing to carry out an obligation of Customer under Subpart E of 45 C.F.R. Part 164, Business Associate shall comply with the requirements of Subpart E applicable to that obligation." },
  { t: "p", s: "2.11  Secretary. Business Associate shall make its internal practices, books, and records relating to the use and disclosure of PHI received from, or created or received on behalf of, Customer available to the Secretary for purposes of determining HIPAA compliance." },
  { t: "p", s: "2.12  Minimum necessary. Business Associate shall request, use, and disclose only the minimum PHI reasonably necessary to accomplish the intended purpose, consistent with 45 C.F.R. \u00a7\u00a7 164.502(b) and 164.514(d), as applicable, except where the minimum-necessary standard does not apply." },
  { t: "h", s: "3.  PERMITTED USES AND DISCLOSURES" },
  { t: "p", s: "3.1  Services. Business Associate may use or disclose PHI as necessary to perform the contracted Services, including communications handling, call answering, routing, escalation, recording, transcription, summarization, quality assurance, service support, security, troubleshooting, and related administrative functions, subject to this Agreement and the minimum-necessary standard." },
  { t: "p", s: "3.2  Designated recipients. Customer authorizes Business Associate to disclose PHI to the on-call clinicians, workforce members, answering points, and other destinations that Customer configures or otherwise designates in writing or in the administrative tools. Customer represents that each such destination is a person or entity to whom the disclosure is permitted under HIPAA (including Customer\u2019s workforce, medical staff, another Covered Entity for treatment, or another Business Associate under appropriate assurances). Business Associate has no duty to independently verify licensure, credentialing, or on-call status beyond applying Customer\u2019s then-current configuration." },
  { t: "p", s: "3.3  Automated processing and AI. Business Associate may use automated technologies, including AI-assisted voice, transcription, summarization, classification, and routing tools, to process PHI solely as necessary to provide, secure, support, or improve the contracted Services for Customer, provided such processing is consistent with HIPAA and this Agreement. Business Associate shall not use Customer\u2019s PHI to train a public or generalized foundation model, or to train or fine-tune a model for purposes unrelated to providing or securing the Services, without Customer\u2019s prior written authorization and any authorization otherwise required by law. Business Associate may use de-identified information in accordance with Section 3.5, and may use PHI for internal quality assurance, prompt or rule refinement, and service improvement for Customer, subject to appropriate safeguards. Business Associate does not warrant that automated output will be error-free." },
  { t: "p", s: "3.4  Management and administration. Business Associate may use PHI for its proper management and administration or to carry out its legal responsibilities, and may disclose PHI for such purposes only if Required by Law or if it obtains reasonable assurances that the recipient will keep the PHI confidential, use or further disclose it only as Required by Law or for the stated purpose, and notify Business Associate of any breach of confidentiality." },
  { t: "p", s: "3.5  Data aggregation and de-identification. Business Associate may provide data aggregation services relating to Customer\u2019s health care operations as permitted by 45 C.F.R. \u00a7 164.504(e)(2)(i)(B) and may de-identify PHI in accordance with 45 C.F.R. \u00a7 164.514(a)\u2013(c). Information that has been properly de-identified is not PHI under this Agreement." },
  { t: "p", s: "3.6  No sale or marketing. Business Associate shall not sell PHI or use PHI for marketing, targeted advertising, or unrelated commercial purposes except as expressly authorized in writing by Customer and permitted by applicable law." },
  { t: "h", s: "4.  OBLIGATIONS OF CUSTOMER" },
  { t: "p", s: "4.1  Notices and restrictions. Customer shall timely notify Business Associate of limitations in its notice of privacy practices, changes or revocations of an Individual\u2019s permission, and restrictions on use or disclosure of PHI, in each case to the extent they may affect Business Associate\u2019s use or disclosure of PHI. Business Associate shall not be required to implement a restriction that is not communicated in writing or that is not technically feasible in the ordinary operation of the Services." },
  { t: "p", s: "4.2  Lawful instructions. Customer shall not request or instruct Business Associate to use or disclose PHI in a manner that would violate HIPAA if done by Customer, except for uses or disclosures expressly permitted for Business Associate\u2019s management and administration, legal responsibilities, or data aggregation. If Customer issues an instruction that Business Associate reasonably determines would cause a violation of HIPAA or other applicable law, Business Associate may decline the instruction and, if necessary, suspend the affected portion of the Services until the Parties agree on a lawful alternative." },
  { t: "p", s: "4.3  Customer responsibilities. Customer is responsible for determining whether its use of the Services is appropriate for its legal and regulatory obligations; providing Business Associate only the PHI reasonably necessary for the Services; maintaining its own HIPAA policies, notices, authorizations, and risk-management program; configuring greetings, scripts, rosters, and escalation rules; obtaining any consents or authorizations required for recording or outbound contact; and notifying Business Associate of special restrictions or handling requirements applicable to PHI provided to Business Associate." },
  { t: "p", s: "4.4  Channel selection. By enabling voice, recording, transcription, SMS, paging, email, or similar channels, Customer authorizes transmission of PHI through those channels and accepts the inherent limitations of the PSTN, cellular networks, unencrypted SMS, and similar carrier services that Business Associate does not operate. Customer is responsible for determining whether a selected channel is appropriate for the sensitivity of the information being sent." },
  { t: "p", s: "4.5  More-stringent regimes. The Services are designed for HIPAA-regulated PHI incident to an answering and routing function. The Services are not designed for records subject to 42 C.F.R. Part 2 (substance use disorder), for attorney-client privileged communications, or for other specialized confidentiality regimes, unless the Parties execute a separate signed addendum expressly covering that regime. Customer shall not knowingly submit such information to the Services in the absence of that addendum." },
  { t: "h", s: "5.  SECURITY, DATA HANDLING, AND SERVICE PROVIDERS" },
  { t: "p", s: "5.1  Security program. Business Associate shall maintain a security program appropriate to the nature of the electronic PHI and the Services, including risk management, access controls, workforce security, incident response, and other measures required by the HIPAA Security Rule with respect to systems Business Associate operates." },
  { t: "p", s: "5.2  Network transit and telephony. Customer acknowledges that inbound and outbound voice communications necessarily traverse carrier networks that Business Associate does not operate. Business Associate\u2019s Security Rule obligations apply to the systems and premises under its reasonable control and not to the PSTN, cellular networks, or other carrier infrastructure. Business Associate will maintain the downstream written assurances required by HIPAA where a provider creates, receives, maintains, or transmits PHI on behalf of Business Associate and qualifies as a Business Associate subcontractor." },
  { t: "p", s: "5.3  Location of processing. Business Associate may use workforce members and subcontractors in the United States. Voice and message traffic may transit other jurisdictions solely as an inherent feature of telecommunications routing. Business Associate will not intentionally store electronic PHI in a designated primary repository outside the United States except with Customer\u2019s written authorization or as Required by Law." },
  { t: "p", s: "5.4  Security information. Upon reasonable written request, not more than once in any twelve (12) month period unless a confirmed Breach or material Security Incident involving Customer\u2019s PHI has occurred, Business Associate will provide Customer information reasonably necessary to evaluate Business Associate\u2019s HIPAA-related safeguards, subject to reasonable confidentiality, security, privilege, and proprietary-information limitations. A current SOC 2 or equivalent independent report, or a reasonably detailed written summary of safeguards, satisfies this Section. Business Associate is not required to disclose information that would materially compromise security, other customers, or privileged material, and is not required to permit unstructured on-site inspection except as Required by Law." },
  { t: "p", s: "5.5  Ownership. As between the Parties, Customer retains all right, title, and interest in PHI. Business Associate acquires no ownership in PHI and may use and disclose it only as permitted by this Agreement, the Service Agreement, or applicable law." },
  { t: "h", s: "6.  TERM AND TERMINATION" },
  { t: "p", s: "6.1  Term. This Agreement is effective as of the Effective Date and remains in effect for so long as Business Associate creates, receives, maintains, or transmits PHI on behalf of Customer, unless terminated in accordance with this Agreement or the Service Agreement." },
  { t: "p", s: "6.2  Termination for cause. Upon Customer\u2019s knowledge of a material breach of this Agreement by Business Associate, Customer shall provide Business Associate a reasonable opportunity, not to exceed thirty (30) calendar days unless the Parties agree otherwise, to cure the breach or end the violation. Customer may terminate this Agreement and the affected Services if cure is not possible or does not occur within the cure period. If termination is not feasible, Customer may exercise any other remedy available under the Service Agreement, and the Parties will take such further action as is required by applicable HIPAA regulations." },
  { t: "p", s: "6.3  Return or destruction. Upon termination or expiration of the Services, Business Associate shall return or destroy all PHI it maintains in any form on behalf of Customer, and shall retain no copies, except as provided in Section 6.4, and shall extend the same obligations to its subcontractors. Business Associate will use commercially reasonable efforts to complete return or destruction within thirty (30) calendar days, subject to technical feasibility, legal or contractual retention obligations (including retention configured by Customer under the applicable SLA), and ordinary backup or archival processes." },
  { t: "p", s: "6.4  Backups and infeasibility. PHI contained in routine backups, disaster-recovery copies, immutable storage, system logs, or archival media need not be separately extracted or destroyed when immediate deletion is not technically feasible, provided Business Associate continues to protect such PHI under this Agreement, does not use or disclose it except for the purpose that makes retention necessary or as Required by Law, and deletes or overwrites it in accordance with the applicable retention lifecycle when feasible. Business Associate shall provide written notice when return or destruction of material PHI is infeasible." },
  { t: "p", s: "6.5  Survival. Business Associate\u2019s obligations concerning PHI retained after termination survive for as long as Business Associate or any subcontractor retains such PHI. Sections 2.11, 6.3 through 6.5, 7, and 8 also survive termination or expiration of this Agreement." },
  { t: "h", s: "7.  LIABILITY ALLOCATION AND NO EXTRA REMEDY" },
  { t: "p", s: "This Agreement does not create any indemnification obligation, liability cap, warranty, or damages remedy independent of the Service Agreement. Fees, payment, limitations of liability, exclusions of damages, indemnification, insurance, and other commercial risk-allocation terms in the Service Agreement apply to this Agreement and to any use or disclosure of PHI, to the maximum extent permitted by law. Nothing in this Section limits a Party\u2019s obligations to the Secretary or any liability that cannot be limited under applicable law." },
  { t: "h", s: "8.  MISCELLANEOUS" },
  { t: "p", s: "8.1  Regulatory references. References to HIPAA provisions mean those provisions as in effect or amended and for which compliance is required." },
  { t: "p", s: "8.2  Amendment. The Parties shall amend this Agreement as reasonably necessary to comply with changes in applicable law. No amendment is effective unless in writing and signed by both Parties, except where applicable law automatically requires a change." },
  { t: "p", s: "8.3  Interpretation and priority. Any ambiguity shall be resolved to permit compliance with HIPAA. If this Agreement conflicts with another agreement between the Parties, this Agreement controls solely as to PHI and HIPAA compliance; otherwise, the Service Agreement controls commercial terms, including fees, warranties, indemnities, and limitations of liability, to the extent permitted by law." },
  { t: "p", s: "8.4  State breach-notification laws. Business Associate will cooperate with Customer, at Customer\u2019s reasonable request, in connection with Customer\u2019s assessment of notice obligations under applicable state consumer or health-data breach laws, including the Florida Information Protection Act of 2014, Fla. Stat. \u00a7 501.171, to the extent such laws apply to the incident. Where Business Associate acts as Customer\u2019s \u201cthird-party agent\u201d under Fla. Stat. \u00a7 501.171, the notice period in Section 2.4 is intended to satisfy Business Associate\u2019s notice obligation under \u00a7 501.171(6). Unless Required by Law to give notice itself, Business Associate\u2019s notice obligation runs to Customer, and Customer remains responsible for notices to Individuals, regulators, and the media." },
  { t: "p", s: "8.5  No third-party beneficiaries. Nothing in this Agreement creates rights or remedies in any person other than the Parties and their respective successors and permitted assigns." },
  { t: "p", s: "8.6  Governing law. This Agreement is governed by the governing-law provision of the Service Agreement; if that agreement is silent, Florida law applies, except to the extent preempted by federal law." },
  { t: "p", s: "8.7  Notices. Notices under this Agreement must be in writing and delivered to the contacts designated by each Party. Security and Breach notices may be delivered to the Customer privacy or security contact designated in writing or, if none is designated, to the primary administrative contact for the Services." },
  { t: "p", s: "8.8  Independent contractor. Business Associate is an independent contractor. Nothing in this Agreement creates a partnership, joint venture, or employment relationship." },
  { t: "p", s: "8.9  Counterparts; electronic signatures. This Agreement may be executed in counterparts and electronically, each of which is deemed an original." },
];

// Fill the per-customer placeholders in the static body text.
function buildBody(company: string, dateLong: string): Block[] {
  return BAA_BLOCKS.map((b) => ({
    t: b.t,
    s: b.s.replace(/\[EFFECTIVE DATE\]/g, dateLong).replace(/\[CLIENT LEGAL NAME\]/g, company),
  }));
}

// Today's date in Eastern Time, formatted like "September 25, 2026".
export function etTodayLong(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export async function generateBaaPdf(
  d: BaaData = {},
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

  const company = d.company?.trim() || "________________________________________";
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
  block("Business Associate Agreement", { size: 19, font: bold, lead: 23, after: 2 });
  block("HIPAA / HITECH — 45 C.F.R. Parts 160 and 164", { size: 9, color: MUTED, lead: 12, after: 1 });
  block("Hardened Form  |  Version 1.2  |  September 2026  |  Doc. No. 2026-AXUS-BAA-001.2", { size: 8, color: MUTED, lead: 11, after: 10 });

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
  block("9. SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block("IN WITNESS WHEREOF, the Parties have caused this Agreement to be executed by their duly authorized representatives as of the Effective Date.", { after: 12 });

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

  const clientName = company === "________________________________________" ? "Customer" : company;
  const party1Slot = sigBlock("Customer", `${clientName} - Customer`, 300);
  const party2Slot = sigBlock("Axus Technologies", "Axus Technologies, LLC - Business Associate", 396);

  // ---- Page numbers, tucked above the letterhead's contact strip ----
  const total = pages.length;
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: T(722), size: 7.5, font: helv, color: MUTED });
  });

  return { bytes: await pdf.save(), layout: [party1Slot, party2Slot] };
}

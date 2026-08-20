// Axus Business Associate Agreement (HIPAA/HITECH) — template PDF generator.
// Built on pdf-lib to match quotepdf.ts (same fonts, palette, logo, and helpers), so the
// aesign backend needs no extra dependency. Produces a branded, multi-page BAA with fill-in
// blanks and two underscore-blank signature blocks that the e-sign editor can auto-anchor.
//
// Axus is pre-identified as the Business Associate; the customer (e.g., a clinic) signs as
// the Covered Entity. Regenerate the stored template with:  npm run gen:baa
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type Color } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ORANGE = rgb(0.92, 0.35, 0.05);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const W = 612;
const H = 792;
const M = 64;
const TOP = 64; // baseline of the first body line on a continuation page (distance from top)
const BOTTOM = H - 64; // lowest baseline before a new page is needed

// Full legal body. Timeframes carry sensible defaults; blanks (____) are per-customer.
const BODY: Array<{ t: "h" | "p"; s: string }> = [
  { t: "p", s: 'This Business Associate Agreement (this "Agreement") is entered into as of ____________________ (the "Effective Date") by and between ________________________________________ ("Covered Entity") and Axus Technologies ("Business Associate"). Covered Entity and Business Associate are each a "Party" and together the "Parties."' },

  { t: "h", s: "Recitals" },
  { t: "p", s: "WHEREAS, the Parties have entered into, or will enter into, one or more arrangements under which Business Associate provides services to or on behalf of Covered Entity, and in connection with those services Business Associate may create, receive, maintain, or transmit Protected Health Information on behalf of Covered Entity;" },
  { t: "p", s: 'WHEREAS, the Parties intend to protect the privacy and provide for the security of such Protected Health Information in compliance with the Health Insurance Portability and Accountability Act of 1996, the Health Information Technology for Economic and Clinical Health Act, and their implementing regulations, each as amended (collectively, "HIPAA");' },
  { t: "p", s: "NOW, THEREFORE, in consideration of the mutual promises below and other good and valuable consideration, the Parties agree as follows." },

  { t: "h", s: "1. Definitions" },
  { t: "p", s: "1.1  Catch-all. Capitalized terms used but not otherwise defined in this Agreement have the meanings given to them in the HIPAA Privacy, Security, and Breach Notification Rules at 45 C.F.R. Parts 160 and 164, including any amendments." },
  { t: "p", s: '1.2  Specific terms. "Breach," "Designated Record Set," "Electronic Protected Health Information" ("ePHI"), "Individual," "Protected Health Information" ("PHI"), "Required by Law," "Secretary," "Security Incident," and "Unsecured PHI" have the meanings given to them in 45 C.F.R. Parts 160 and 164. For purposes of this Agreement, "PHI" is limited to information Business Associate creates, receives, maintains, or transmits for or on behalf of Covered Entity.' },

  { t: "h", s: "2. Obligations and Activities of Business Associate" },
  { t: "p", s: "Business Associate agrees that it shall:" },
  { t: "p", s: "2.1  Not use or disclose PHI other than as permitted or required by this Agreement or as Required by Law." },
  { t: "p", s: "2.2  Safeguards. Use appropriate safeguards, and comply with Subpart C of 45 C.F.R. Part 164 with respect to ePHI, to prevent use or disclosure of PHI other than as provided for by this Agreement, and implement administrative, physical, and technical safeguards that reasonably and appropriately protect the confidentiality, integrity, and availability of the ePHI it creates, receives, maintains, or transmits." },
  { t: "p", s: "2.3  Mitigation. Take reasonable steps to mitigate, to the extent practicable, any harmful effect known to Business Associate of a use or disclosure of PHI in violation of this Agreement." },
  { t: "p", s: "2.4  Reporting. Report to Covered Entity any use or disclosure of PHI not provided for by this Agreement, any Security Incident, and any Breach of Unsecured PHI (as required by 45 C.F.R. Sec. 164.410) of which it becomes aware, without unreasonable delay and in no event later than ten (10) calendar days after discovery, including the information described in 45 C.F.R. Sec. 164.410(c) to the extent known. The Parties acknowledge this Section as notice that unsuccessful Security Incidents (e.g., pings, port scans, and denied access attempts) occur routinely and require no additional individual notice." },
  { t: "p", s: "2.5  Subcontractors. In accordance with 45 C.F.R. Sec. 164.502(e)(1)(ii) and Sec. 164.308(b)(2), ensure that any subcontractor that creates, receives, maintains, or transmits PHI on behalf of Business Associate agrees in writing to restrictions and conditions at least as stringent as those that apply to Business Associate under this Agreement." },
  { t: "p", s: "2.6  Access. Make available PHI in a Designated Record Set to Covered Entity (or, as directed by Covered Entity, to an Individual) as necessary to satisfy Covered Entity's obligations under 45 C.F.R. Sec. 164.524, within thirty (30) calendar days of a request." },
  { t: "p", s: "2.7  Amendment. Make any amendment(s) to PHI in a Designated Record Set as directed or agreed to by Covered Entity pursuant to 45 C.F.R. Sec. 164.526, or take other measures necessary to satisfy Covered Entity's obligations under that section." },
  { t: "p", s: "2.8  Accounting of Disclosures. Maintain and make available the information required to provide an accounting of disclosures as necessary to satisfy Covered Entity's obligations under 45 C.F.R. Sec. 164.528." },
  { t: "p", s: "2.9  Covered Entity Obligations. To the extent Business Associate is to carry out one or more of Covered Entity's obligations under Subpart E of 45 C.F.R. Part 164, comply with the requirements of Subpart E that apply to Covered Entity in the performance of such obligation(s)." },
  { t: "p", s: "2.10  Availability to the Secretary. Make its internal practices, books, and records relating to the use and disclosure of PHI available to the Secretary for purposes of determining compliance with HIPAA." },
  { t: "p", s: "2.11  Minimum Necessary. Request, use, and disclose only the minimum amount of PHI necessary to accomplish the intended purpose, consistent with 45 C.F.R. Sec. 164.502(b) and Sec. 164.514(d)." },

  { t: "h", s: "3. Permitted Uses and Disclosures by Business Associate" },
  { t: "p", s: "3.1  General. Business Associate may use or disclose PHI only as necessary to perform the services provided to Covered Entity, as otherwise permitted by this Agreement, or as Required by Law." },
  { t: "p", s: "3.2  Consistency. Business Associate may not use or disclose PHI in a manner that would violate Subpart E of 45 C.F.R. Part 164 if done by Covered Entity, except as set out in Sections 3.3 and 3.4." },
  { t: "p", s: "3.3  Management and Administration. Business Associate may use PHI for its proper management and administration or to carry out its legal responsibilities, and may disclose PHI for such purposes only if the disclosure is Required by Law or Business Associate obtains reasonable assurances from the recipient that the PHI will remain confidential, be used or further disclosed only as Required by Law or for the purpose for which it was disclosed, and that the recipient will notify Business Associate of any breach of confidentiality." },
  { t: "p", s: "3.4  Data Aggregation. Business Associate may provide data aggregation services relating to the health care operations of Covered Entity as permitted by 45 C.F.R. Sec. 164.504(e)(2)(i)(B), and may de-identify PHI in accordance with 45 C.F.R. Sec. 164.514(a)-(c)." },

  { t: "h", s: "4. Obligations of Covered Entity" },
  { t: "p", s: "4.1  Covered Entity shall notify Business Associate of any limitation(s) in its notice of privacy practices under 45 C.F.R. Sec. 164.520, to the extent such limitation may affect Business Associate's use or disclosure of PHI." },
  { t: "p", s: "4.2  Covered Entity shall notify Business Associate of any changes in, or revocation of, an Individual's permission to use or disclose PHI, to the extent such changes may affect Business Associate's use or disclosure of PHI." },
  { t: "p", s: "4.3  Covered Entity shall notify Business Associate of any restriction on the use or disclosure of PHI that Covered Entity has agreed to or is required to abide by under 45 C.F.R. Sec. 164.522, to the extent such restriction may affect Business Associate's use or disclosure of PHI." },
  { t: "p", s: "4.4  Covered Entity shall not request that Business Associate use or disclose PHI in any manner that would not be permissible under Subpart E of 45 C.F.R. Part 164 if done by Covered Entity, except as permitted under Sections 3.3 and 3.4." },

  { t: "h", s: "5. Term and Termination" },
  { t: "p", s: "5.1  Term. This Agreement is effective as of the Effective Date and remains in effect until all PHI provided by Covered Entity to Business Associate, or created or received by Business Associate on behalf of Covered Entity, is destroyed or returned to Covered Entity, or, if return or destruction is infeasible, protections are extended to such PHI in accordance with Section 5.3." },
  { t: "p", s: "5.2  Termination for Cause. Upon Covered Entity's knowledge of a material breach by Business Associate, Covered Entity shall provide an opportunity for Business Associate to cure the breach or end the violation within thirty (30) calendar days and may terminate this Agreement if Business Associate does not cure within that period; may immediately terminate if cure is not possible; or, if neither termination nor cure is feasible, report the violation to the Secretary." },
  { t: "p", s: "5.3  Effect of Termination. Upon termination or expiration, Business Associate shall return or destroy all PHI it still maintains in any form, retaining no copies, and shall extend this obligation to its subcontractors, in each case within thirty (30) calendar days. If return or destruction is infeasible, Business Associate shall provide written notice of the conditions that make it infeasible, extend the protections of this Agreement to such PHI, and limit further uses and disclosures to those purposes that make return or destruction infeasible for so long as it retains the PHI." },
  { t: "p", s: "5.4  Survival. The obligations of Business Associate under this Section 5 survive termination or expiration of this Agreement." },

  { t: "h", s: "6. Miscellaneous" },
  { t: "p", s: "6.1  Regulatory References. A reference to a section of HIPAA means the section as in effect or amended and for which compliance is required." },
  { t: "p", s: "6.2  Amendment. The Parties agree to take such action as is necessary to amend this Agreement from time to time for compliance with HIPAA and other applicable law. No amendment is effective unless in writing and signed by both Parties." },
  { t: "p", s: "6.3  Interpretation. Any ambiguity in this Agreement shall be resolved to permit the Parties to comply with HIPAA. In the event of a conflict between this Agreement and any other agreement between the Parties, this Agreement controls as to the subject matter of PHI and HIPAA compliance." },
  { t: "p", s: "6.4  No Third-Party Beneficiaries. Nothing in this Agreement confers any rights, remedies, obligations, or liabilities upon any person other than the Parties and their respective successors and permitted assigns." },
  { t: "p", s: "6.5  Governing Law. This Agreement is governed by the laws of the State of ____________________, without regard to its conflict-of-laws provisions, except to the extent preempted by federal law." },
  { t: "p", s: "6.6  Notices. All notices under this Agreement shall be in writing and delivered to the contacts each Party designates in writing." },
  { t: "p", s: "6.7  Counterparts; Electronic Signatures. This Agreement may be executed in counterparts, each deemed an original and all of which together constitute one instrument. The Parties consent to the use of electronic records and electronic signatures, which have the same legal effect as handwritten signatures under the U.S. E-SIGN Act and applicable state law." },
];

const SIG_LINES = [
  "Signature: ______________________________    Date: ______________",
  "Printed Name: ___________________________",
  "Title: __________________________________",
];

export async function generateBaaPdf(assetsDir = join(process.cwd(), "assets")): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try {
    logo = await pdf.embedPng(await readFile(join(assetsDir, "axus-logo.png")));
  } catch {
    /* logo optional */
  }

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

  const newPage = (first = false) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    if (first && logo) {
      const lw = 150;
      const lh = (lw * 125) / 238;
      page.drawImage(logo, { x: M, y: T(48) - lh, width: lw, height: lh });
      page.drawLine({ start: { x: M, y: T(148) }, end: { x: W - M, y: T(148) }, thickness: 2, color: ORANGE });
      y = 168; // below the header rule
    } else {
      y = TOP;
    }
  };

  const ensure = (space: number) => {
    if (y + space > BOTTOM) newPage();
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

  // ---- Page 1: header + title ----
  newPage(true);
  block("Business Associate Agreement", { size: 19, font: bold, lead: 23, after: 2 });
  block("HIPAA / HITECH - 45 C.F.R. Parts 160 and 164", { size: 9, color: MUTED, lead: 12, after: 10 });

  // ---- Body ----
  for (const b of BODY) {
    if (b.t === "h") {
      ensure(46);
      y += 8;
      block(b.s.toUpperCase(), { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
    } else {
      block(b.s);
    }
  }

  // ---- Signatures (kept together) ----
  ensure(220);
  y += 8;
  block("7. SIGNATURES", { size: 11.5, font: bold, color: ORANGE, lead: 15, after: 4 });
  block("IN WITNESS WHEREOF, the Parties have caused this Agreement to be executed by their duly authorized representatives as of the Effective Date.", { after: 12 });

  const sigBlock = (heading: string) => {
    ensure(110);
    block(heading, { size: 10, font: bold, after: 8 });
    for (const ln of SIG_LINES) {
      ensure(20);
      page.drawText(ln, { x: M, y: T(y), size: 11, font: mono, color: INK });
      y += 20;
    }
    y += 14;
  };
  sigBlock("COVERED ENTITY");
  sigBlock("BUSINESS ASSOCIATE - AXUS TECHNOLOGIES");

  // ---- Footer (page X of Y) on every page ----
  const total = pages.length;
  pages.forEach((p, i) => {
    const fy = T(H - 44);
    p.drawText("Axus Technologies - Business Associate Agreement", { x: M, y: fy, size: 7.5, font: helv, color: MUTED });
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: W - M - helv.widthOfTextAtSize(pn, 7.5), y: fy, size: 7.5, font: helv, color: MUTED });
  });

  return pdf.save();
}

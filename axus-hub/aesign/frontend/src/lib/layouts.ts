// Fixed signature-block layouts of the Axus-GENERATED templates (mirrors the
// backend generators). Shared by the editor (auto-place per signer) and the
// in-app "Sign as Axus" (fallback when a returned copy has no text layer).
import type { SignSlot } from "@/lib/api";

// BAA is generated on the fly (backend/src/baapdf.ts, Hardened Form v1.2) on the Axus
// letterhead with two signers (Customer, then Axus Technologies) STACKED on a dedicated
// final page (page 8), each with Signature/Date on one row and Print Name/Title on the next.
// Coordinates match the generator's returned layout exactly. Add recipients IN THIS ORDER.
export const BAA_LAYOUT: SignSlot[] = [
  {
    role: "Customer",
    fields: [
      { type: "signature", page: 8, x: 0.1889, y: 0.3965, w: 0.3275, h: 0.0189 },
      { type: "date", page: 8, x: 0.5979, y: 0.3965, w: 0.2975, h: 0.0189 },
      { type: "name", page: 8, x: 0.2009, y: 0.4318, w: 0.3155, h: 0.0189 },
      { type: "title", page: 8, x: 0.5942, y: 0.4318, w: 0.3012, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 8, x: 0.1889, y: 0.5177, w: 0.3275, h: 0.0189 },
      { type: "date", page: 8, x: 0.5979, y: 0.5177, w: 0.2975, h: 0.0189 },
      { type: "name", page: 8, x: 0.2009, y: 0.553, w: 0.3155, h: 0.0189 },
      { type: "title", page: 8, x: 0.5942, y: 0.553, w: 0.3012, h: 0.0189 },
    ],
  },
];

// Certificate of Completion has two signers (Customer, then Axus Technologies)
// with FIXED signature-block positions on the final page — mirrors backend
// cocpdf.generateCocPdf(). Add recipients IN THIS ORDER for auto-placement.
export const COC_LAYOUT: SignSlot[] = [
  {
    role: "Customer",
    fields: [
      { type: "signature", page: 1, x: 0.1758, y: 0.7323, w: 0.3013, h: 0.0189 },
      { type: "name", page: 1, x: 0.1878, y: 0.7601, w: 0.2893, h: 0.0189 },
      { type: "title", page: 1, x: 0.1367, y: 0.7879, w: 0.3404, h: 0.0189 },
      { type: "date", page: 1, x: 0.1404, y: 0.8157, w: 0.3368, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 1, x: 0.6072, y: 0.7323, w: 0.3013, h: 0.0189 },
      { type: "name", page: 1, x: 0.6192, y: 0.7601, w: 0.2893, h: 0.0189 },
      { type: "title", page: 1, x: 0.5681, y: 0.7879, w: 0.3404, h: 0.0189 },
      { type: "date", page: 1, x: 0.5717, y: 0.8157, w: 0.3368, h: 0.0189 },
    ],
  },
];

// SLA (After Hours On Call, Hardened Form v1.2) has two signers (Client, then Axus
// Technologies) STACKED on a dedicated final page (page 7), each with Signature/Date on one
// row and Print Name/Title on the next — mirrors the Axus SOW block and backend
// slapdf.generateSlaPdf(). Coordinates match the generator's returned layout exactly.
export const SLA_LAYOUT: SignSlot[] = [
  {
    role: "Client",
    fields: [
      { type: "signature", page: 7, x: 0.1889, y: 0.3965, w: 0.3275, h: 0.0189 },
      { type: "date", page: 7, x: 0.5979, y: 0.3965, w: 0.2975, h: 0.0189 },
      { type: "name", page: 7, x: 0.2009, y: 0.4318, w: 0.3155, h: 0.0189 },
      { type: "title", page: 7, x: 0.5942, y: 0.4318, w: 0.3012, h: 0.0189 },
    ],
  },
  {
    role: "Axus Technologies",
    fields: [
      { type: "signature", page: 7, x: 0.1889, y: 0.5177, w: 0.3275, h: 0.0189 },
      { type: "date", page: 7, x: 0.5979, y: 0.5177, w: 0.2975, h: 0.0189 },
      { type: "name", page: 7, x: 0.2009, y: 0.553, w: 0.3155, h: 0.0189 },
      { type: "title", page: 7, x: 0.5942, y: 0.553, w: 0.3012, h: 0.0189 },
    ],
  },
];

// The template layout for a document type, if it has one.
export function templateLayout(docType: string | null | undefined): SignSlot[] | undefined {
  return docType === "BAA"
    ? BAA_LAYOUT
    : docType === "Certificate of Completion"
      ? COC_LAYOUT
      : docType === "SLA"
        ? SLA_LAYOUT
        : undefined;
}

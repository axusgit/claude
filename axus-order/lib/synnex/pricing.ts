// lib/synnex/pricing.ts
// Converts SERVER-ONLY partner cost into the client-facing ballpark.
// This is the boundary: `cost` goes in, only `unitBallpark` (and optional msrp) comes out.
import type { PriceAvailability } from "./adapter";

export type MarginRule =
  | { type: "PERCENT"; value: number }  // 15 => cost * 1.15
  | { type: "FIXED"; value: number };   // 50 => cost + 50

// Everything here is safe to send to the browser. Note: no `cost` field.
export interface BallparkLine {
  synnexSKU: string | null;
  mfgPN: string | null;
  description: string | null;
  status: string;
  available: number;
  inStock: boolean;
  unitBallpark: number | null; // null when the item isn't quotable
  msrp: number | null;         // optional anchor
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toBallpark(pa: PriceAvailability, rule: MarginRule): BallparkLine {
  let unitBallpark: number | null = null;
  if (pa.isQuotable && pa.cost != null) {
    unitBallpark =
      rule.type === "PERCENT"
        ? round2(pa.cost * (1 + rule.value / 100))
        : round2(pa.cost + rule.value);
  }
  return {
    synnexSKU: pa.synnexSKU,
    mfgPN: pa.mfgPN,
    description: pa.description,
    status: pa.status,
    available: pa.totalQuantity,
    inStock: pa.totalQuantity > 0,
    unitBallpark,
    msrp: pa.msrp,
  };
}

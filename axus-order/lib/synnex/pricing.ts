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

// Budgetary presentation: round the client-facing unit price UP to the nearest
// increment (BUDGET_ROUND_UP, default $5) so quotes read as estimates and round
// in the safe direction for a budget. Set BUDGET_ROUND_UP=0 for exact figures.
const roundUp = (n: number): number => {
  const step = Number(process.env.BUDGET_ROUND_UP ?? "5");
  return step > 0 ? Math.ceil(n / step) * step : round2(n);
};

export function toBallpark(pa: PriceAvailability, rule: MarginRule): BallparkLine {
  let unitBallpark: number | null = null;
  if (pa.isQuotable && pa.cost != null) {
    const marked =
      rule.type === "PERCENT"
        ? pa.cost * (1 + rule.value / 100)
        : pa.cost + rule.value;
    unitBallpark = roundUp(marked);
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

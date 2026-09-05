// lib/synnex/quote-service.ts
// Turns a cart + catalog into a priced, client-safe quote.
// Internally it sees partner cost; externally it returns only ballpark prices.
import {
  type SynnexAdapter, type SkuQuery, type PriceAvailability,
} from "./adapter";
import { getAdapter } from "./index";
import { toBallpark, type MarginRule, type BallparkLine } from "./pricing";

export interface CatalogItemInput {
  id: string;
  internalName: string;
  synnexSKU: string | null;
  mfgPN: string | null;
  marginType: "PERCENT" | "FIXED";
  marginValue: number;
}
export interface CartLineInput {
  catalogItemId: string;
  qty: number;
}

// Client-safe: extends BallparkLine (which has NO cost) with quote context.
export interface QuoteLineResult extends BallparkLine {
  catalogItemId: string;
  internalName: string;
  qty: number;
  lineTotal: number | null; // unitBallpark * qty
  unavailableReason?: string;
}

export interface QuoteBuild {
  lines: QuoteLineResult[];
  subtotal: number;
  hasUnavailable: boolean;
  currency: "USD";
  validUntil: Date;
  // SERVER ONLY — persist for audit if you like, but NEVER serialize to the browser:
  _serverCostByCatalogItemId: Record<string, number | null>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildQuote(
  cart: CartLineInput[],
  catalog: CatalogItemInput[],
  opts?: { adapter?: SynnexAdapter; validHours?: number }
): Promise<QuoteBuild> {
  const adapter = opts?.adapter ?? getAdapter();
  const validHours = opts?.validHours ?? 24 * 30; // 30-day budgetary validity window
  const byId = new Map(catalog.map((c) => [c.id, c]));

  // Build P&A queries with stable line numbers so we can match results back.
  const queries: SkuQuery[] = [];
  cart.forEach((cl, i) => {
    const item = byId.get(cl.catalogItemId);
    if (!item) return;
    // No identifier -> don't send an empty query to the API (it can error the whole
    // batch). It falls through as "Not found" -> "Contact us" below.
    if (!item.synnexSKU && !item.mfgPN) return;
    queries.push({
      synnexSKU: item.synnexSKU ?? undefined,
      mfgPN: item.synnexSKU ? undefined : item.mfgPN ?? undefined, // prefer exact SKU
      lineNumber: i + 1,
    });
  });

  const pa = queries.length ? await adapter.getPriceAvailability(queries) : [];

  // One mfgPN can expand to several SKUs -> keep the best (Active w/ cost) per line.
  const bestByLine = new Map<number, PriceAvailability>();
  for (const r of pa) {
    const cur = bestByLine.get(r.lineNumber);
    if (!cur || (!cur.isQuotable && r.isQuotable)) bestByLine.set(r.lineNumber, r);
  }

  const lines: QuoteLineResult[] = [];
  const serverCost: Record<string, number | null> = {};
  let subtotal = 0;
  let hasUnavailable = false;

  cart.forEach((cl, i) => {
    const item = byId.get(cl.catalogItemId);
    if (!item) return;
    const qty = Math.max(1, Math.floor(cl.qty || 1));
    const found = bestByLine.get(i + 1);
    const rule: MarginRule = { type: item.marginType, value: item.marginValue };

    if (!found) {
      hasUnavailable = true;
      serverCost[item.id] = null;
      lines.push({
        catalogItemId: item.id, internalName: item.internalName,
        synnexSKU: item.synnexSKU, mfgPN: item.mfgPN, description: null,
        status: "Not found", available: 0, inStock: false,
        unitBallpark: null, msrp: null, qty, lineTotal: null,
        unavailableReason: "No pricing returned",
      });
      return;
    }

    const bp = toBallpark(found, rule);
    serverCost[item.id] = found.cost; // server-only snapshot
    const lineTotal = bp.unitBallpark != null ? round2(bp.unitBallpark * qty) : null;
    if (lineTotal != null) subtotal = round2(subtotal + lineTotal);
    if (bp.unitBallpark == null) hasUnavailable = true;

    lines.push({
      ...bp,
      catalogItemId: item.id,
      internalName: item.internalName,
      qty,
      lineTotal,
      unavailableReason: bp.unitBallpark == null ? `Not quotable (${bp.status})` : undefined,
    });
  });

  return {
    lines,
    subtotal,
    hasUnavailable,
    currency: "USD",
    validUntil: new Date(Date.now() + validHours * 3_600_000),
    _serverCostByCatalogItemId: serverCost,
  };
}

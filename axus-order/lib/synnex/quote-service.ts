// lib/synnex/quote-service.ts
// Turns a cart + catalog into a priced, client-safe quote.
// Internally it sees partner cost; externally it returns only ballpark prices.
import {
  idQuery, type SynnexAdapter, type SkuQuery, type PriceAvailability,
} from "./adapter";
import { getAdapter } from "./index";
import { toBallpark, type MarginRule, type BallparkLine } from "./pricing";

export interface CatalogItemInput {
  id: string;
  internalName: string;
  synnexSKU: string | null;
  mfgPN: string | null;
  replacementSku?: string | null;
  replacementName?: string | null;
  marginType: "PERCENT" | "FIXED";
  marginValue: number;
}
export interface CartLineInput {
  catalogItemId: string;
  qty: number;
  useReplacement?: boolean; // price + label this line as the item's replacement part
}

// The identifiers + display name to price a line by, honoring an accepted replacement.
function effectiveId(item: CatalogItemInput, useReplacement?: boolean) {
  const rep = item.replacementSku?.trim();
  if (useReplacement && rep) {
    const numeric = /^\d+$/.test(rep);
    return {
      synnexSKU: numeric ? rep : undefined,
      mfgPN: numeric ? undefined : rep,
      name: item.replacementName?.trim() || item.internalName,
      sku: numeric ? rep : null,
      mpn: numeric ? null : rep,
      isReplacement: true,
    };
  }
  const q = idQuery(item.synnexSKU, item.mfgPN);
  return {
    synnexSKU: q.synnexSKU,
    mfgPN: q.mfgPN,
    name: item.internalName,
    sku: q.synnexSKU ?? null,
    mpn: q.mfgPN ?? null,
    isReplacement: false,
  };
}

// Client-safe: extends BallparkLine (which has NO cost) with quote context.
export interface QuoteLineResult extends BallparkLine {
  catalogItemId: string;
  internalName: string;
  qty: number;
  lineTotal: number | null; // unitBallpark * qty
  unavailableReason?: string;
  usedReplacement: boolean; // the customer accepted the suggested alternative
  originalName: string; // the original item this line's replacement stands in for
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
  // Effective identifier per cart line (honors an accepted replacement).
  const effs = cart.map((cl) => {
    const item = byId.get(cl.catalogItemId);
    return item ? effectiveId(item, cl.useReplacement) : null;
  });

  // Build P&A queries with stable line numbers so we can match results back.
  const queries: SkuQuery[] = [];
  cart.forEach((cl, i) => {
    const eff = effs[i];
    if (!eff) return;
    // No identifier -> don't send an empty query to the API (it can error the whole
    // batch). It falls through as "Not found" -> "Contact us" below.
    if (!eff.synnexSKU && !eff.mfgPN) return;
    queries.push({
      synnexSKU: eff.synnexSKU,
      mfgPN: eff.mfgPN,
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
    const eff = effs[i];
    if (!item || !eff) return;
    const qty = Math.max(1, Math.floor(cl.qty || 1));
    const found = bestByLine.get(i + 1);
    const rule: MarginRule = { type: item.marginType, value: item.marginValue };
    const displayName = eff.name;

    if (!found) {
      hasUnavailable = true;
      serverCost[item.id] = null;
      lines.push({
        catalogItemId: item.id, internalName: displayName,
        synnexSKU: eff.sku, mfgPN: eff.mpn, description: null,
        status: "Not found", available: 0, inStock: false,
        unitBallpark: null, msrp: null, qty, lineTotal: null,
        unavailableReason: "No pricing returned",
        usedReplacement: eff.isReplacement, originalName: item.internalName,
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
      internalName: displayName,
      qty,
      lineTotal,
      unavailableReason: bp.unitBallpark == null ? `Not quotable (${bp.status})` : undefined,
      usedReplacement: eff.isReplacement,
      originalName: item.internalName,
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

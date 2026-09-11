// lib/synnex/quote-service.ts
// Turns a cart + catalog into a priced, client-safe quote using the NIGHTLY CACHED
// ballpark prices (the same prices the catalog shows) — no live distributor call.
import { idQuery } from "./adapter";
import { type BallparkLine } from "./pricing";

export interface CatalogItemInput {
  id: string;
  internalName: string;
  synnexSKU: string | null;
  mfgPN: string | null;
  replacementSku?: string | null;
  replacementName?: string | null;
  cachedUnitPrice?: number | null;
  cachedReplacementPrice?: number | null;
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
  opts?: { validHours?: number }
): Promise<QuoteBuild> {
  const validHours = opts?.validHours ?? 24 * 30; // 30-day budgetary validity window
  const byId = new Map(catalog.map((c) => [c.id, c]));

  const lines: QuoteLineResult[] = [];
  const serverCost: Record<string, number | null> = {};
  let subtotal = 0;
  let hasUnavailable = false;

  cart.forEach((cl) => {
    const item = byId.get(cl.catalogItemId);
    if (!item) return;
    const eff = effectiveId(item, cl.useReplacement);
    const qty = Math.max(1, Math.floor(cl.qty || 1));
    // Use the SAME nightly cached ballpark the catalog shows.
    const unitBallpark =
      (cl.useReplacement ? item.cachedReplacementPrice : item.cachedUnitPrice) ?? null;
    const lineTotal = unitBallpark != null ? round2(unitBallpark * qty) : null;
    if (lineTotal != null) subtotal = round2(subtotal + lineTotal);
    if (unitBallpark == null) hasUnavailable = true;
    serverCost[item.id] = null; // partner cost is not tracked in the cached model

    lines.push({
      catalogItemId: item.id,
      internalName: eff.name,
      synnexSKU: eff.sku,
      mfgPN: eff.mpn,
      description: null,
      status: unitBallpark != null ? "Active" : "Not found",
      available: 0,
      inStock: false,
      unitBallpark,
      msrp: null,
      qty,
      lineTotal,
      unavailableReason: unitBallpark == null ? "Not available" : undefined,
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

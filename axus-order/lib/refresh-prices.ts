// lib/refresh-prices.ts
// Refreshes every catalog item's cached ballpark price (its own + its replacement)
// from the distributor, in ONE batched call. Run nightly by the cron job so the
// catalog reads cached prices instead of hitting the distributor on every request.
import { prisma } from "./prisma";
import { getAdapter } from "./synnex";
import { idQuery, type SkuQuery, type PriceAvailability } from "./synnex/adapter";
import { toBallpark, type MarginRule } from "./synnex/pricing";

const REP = 100000; // line-number offset for replacement queries

export async function refreshPrices(): Promise<{ updated: number; at: Date }> {
  const items = await prisma.catalogItem.findMany();

  const queries: SkuQuery[] = [];
  const lineToId = new Map<number, string>();
  const repLineToId = new Map<number, string>();
  items.forEach((it, i) => {
    const q = idQuery(it.synnexSKU, it.mfgPN);
    if (q.synnexSKU || q.mfgPN) {
      lineToId.set(i + 1, it.id);
      queries.push({ ...q, lineNumber: i + 1 });
    }
    const rep = it.replacementSku?.trim();
    if (rep) {
      const numeric = /^\d+$/.test(rep);
      repLineToId.set(REP + i + 1, it.id);
      queries.push({
        synnexSKU: numeric ? rep : undefined,
        mfgPN: numeric ? undefined : rep,
        lineNumber: REP + i + 1,
      });
    }
  });

  const pa = queries.length ? await getAdapter().getPriceAvailability(queries) : [];
  const best = new Map<number, PriceAvailability>();
  for (const r of pa) {
    const cur = best.get(r.lineNumber);
    if (!cur || (!cur.isQuotable && r.isQuotable)) best.set(r.lineNumber, r);
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const priceById = new Map<string, number | null>();
  const repById = new Map<string, number | null>();
  for (const [line, r] of best) {
    const isRep = line >= REP;
    const id = (isRep ? repLineToId : lineToId).get(line);
    const it = id ? byId.get(id) : undefined;
    if (!it) continue;
    const rule: MarginRule = {
      type: it.marginType as "PERCENT" | "FIXED",
      value: it.marginValue,
    };
    const bp = toBallpark(r, rule).unitBallpark;
    (isRep ? repById : priceById).set(it.id, bp);
  }

  const at = new Date();
  // If the distributor returned nothing at all (total outage), keep the last-good
  // cached prices rather than wiping the whole catalog to "Not available".
  if (!pa.length && items.some((i) => i.cachedUnitPrice != null)) {
    return { updated: 0, at };
  }

  let updated = 0;
  for (const it of items) {
    await prisma.catalogItem.update({
      where: { id: it.id },
      data: {
        cachedUnitPrice: priceById.get(it.id) ?? null,
        cachedReplacementPrice: repById.get(it.id) ?? null,
        pricedAt: at,
      },
    });
    updated++;
  }
  return { updated, at };
}

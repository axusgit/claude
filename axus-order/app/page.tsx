import { prisma } from "@/lib/prisma";
import { CatalogBrowser, type CatalogCardItem } from "./components/CatalogBrowser";
import { getAdapter } from "@/lib/synnex";
import { toBallpark, type MarginRule } from "@/lib/synnex/pricing";
import { idQuery, type SkuQuery, type PriceAvailability } from "@/lib/synnex/adapter";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const items = await prisma.catalogItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });

  // Live unit prices — CLIENT-SAFE ballpark only (never partner cost). One batched
  // call covers each item's own SKU AND its admin-defined replacement part.
  const REP = 100000; // line-number offset for replacement queries
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

  const priceById = new Map<string, number | null>();
  const repPriceById = new Map<string, number | null>();
  try {
    const pa = queries.length ? await getAdapter().getPriceAvailability(queries) : [];
    const best = new Map<number, PriceAvailability>();
    for (const r of pa) {
      const cur = best.get(r.lineNumber);
      if (!cur || (!cur.isQuotable && r.isQuotable)) best.set(r.lineNumber, r);
    }
    const byId = new Map(items.map((i) => [i.id, i]));
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
      (isRep ? repPriceById : priceById).set(it.id, bp);
    }
  } catch {
    /* pricing source unavailable — leave prices null (shown as "Contact us") */
  }

  const catalog: CatalogCardItem[] = items.map((i) => ({
    id: i.id,
    category: i.category ?? "Other",
    internalName: i.internalName,
    description: i.description,
    partNo: i.mfgPN ?? i.synnexSKU,
    unitPrice: priceById.get(i.id) ?? null,
    replacementName: i.replacementName ?? null,
    replacementPartNo: i.replacementSku ?? null,
    replacementPrice: repPriceById.get(i.id) ?? null,
  }));

  return <CatalogBrowser catalog={catalog} />;
}

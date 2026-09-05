import { prisma } from "@/lib/prisma";
import { CatalogBrowser, type CatalogCardItem } from "./components/CatalogBrowser";
import { getAdapter } from "@/lib/synnex";
import { toBallpark, type MarginRule } from "@/lib/synnex/pricing";
import type { SkuQuery, PriceAvailability } from "@/lib/synnex/adapter";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const items = await prisma.catalogItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });

  // Live unit prices — CLIENT-SAFE ballpark only (never partner cost). One batched call.
  const queries: SkuQuery[] = [];
  const lineToId = new Map<number, string>();
  items.forEach((it, i) => {
    if (!it.synnexSKU && !it.mfgPN) return;
    const line = i + 1;
    lineToId.set(line, it.id);
    queries.push({
      synnexSKU: it.synnexSKU ?? undefined,
      mfgPN: it.synnexSKU ? undefined : it.mfgPN ?? undefined,
      lineNumber: line,
    });
  });

  const priceById = new Map<string, number | null>();
  try {
    const pa = queries.length ? await getAdapter().getPriceAvailability(queries) : [];
    const best = new Map<number, PriceAvailability>();
    for (const r of pa) {
      const cur = best.get(r.lineNumber);
      if (!cur || (!cur.isQuotable && r.isQuotable)) best.set(r.lineNumber, r);
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const [line, r] of best) {
      const id = lineToId.get(line);
      const it = id ? byId.get(id) : undefined;
      if (!it) continue;
      const rule: MarginRule = {
        type: it.marginType as "PERCENT" | "FIXED",
        value: it.marginValue,
      };
      priceById.set(it.id, toBallpark(r, rule).unitBallpark);
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
  }));

  return <CatalogBrowser catalog={catalog} />;
}

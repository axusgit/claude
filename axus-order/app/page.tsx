import { prisma } from "@/lib/prisma";
import { CatalogBrowser, type CatalogCardItem } from "./components/CatalogBrowser";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const items = await prisma.catalogItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });

  // Prices come from the nightly cache (refreshed 1 AM ET) — not a live call on
  // every request. See lib/refresh-prices.ts + /api/cron/refresh-prices.
  const catalog: CatalogCardItem[] = items.map((i) => ({
    id: i.id,
    category: i.category ?? "Other",
    internalName: i.internalName,
    description: i.description,
    partNo: i.mfgPN ?? i.synnexSKU,
    unitPrice: i.cachedUnitPrice ?? null,
    replacementName: i.replacementName ?? null,
    replacementPartNo: i.replacementSku ?? null,
    replacementPrice: i.cachedReplacementPrice ?? null,
  }));

  return <CatalogBrowser catalog={catalog} />;
}

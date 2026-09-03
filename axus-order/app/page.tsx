import { prisma } from "@/lib/prisma";
import { CatalogBrowser, type CatalogCardItem } from "./components/CatalogBrowser";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const items = await prisma.catalogItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });

  // Client-safe projection ONLY — margin fields and any cost stay on the server.
  const catalog: CatalogCardItem[] = items.map((i) => ({
    id: i.id,
    category: i.category ?? "Other",
    internalName: i.internalName,
    description: i.description,
    mfgPN: i.mfgPN,
    synnexSKU: i.synnexSKU,
  }));

  return <CatalogBrowser catalog={catalog} />;
}

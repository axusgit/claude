// prisma/seed.ts
// Seeds the catalog from the provided Files/catalog-seed.csv (real products).
// Idempotent: skips if the catalog is already populated (RESEED=1 wipes first).
//
//   npm run seed          # seed if empty
//   RESEED=1 npm run seed # wipe catalog + quotes, then reseed
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

// The CSV has exactly these 7 columns; only `notes` (last) might contain commas,
// so we split into the first 6 fields and rejoin the remainder as notes.
const HEADER = ["category", "internalName", "mfgPN", "synnexSKU", "marginType", "marginValue", "notes"];

interface Row {
  category: string;
  internalName: string;
  mfgPN: string;
  synnexSKU: string;
  marginType: string;
  marginValue: string;
  notes: string;
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return [];
  return lines.map((line) => {
    const parts = line.split(",");
    const fixed = parts.slice(0, HEADER.length - 1);
    const notes = parts.slice(HEADER.length - 1).join(","); // rejoin any commas in notes
    const cols = [...fixed, notes];
    const row: Record<string, string> = {};
    HEADER.forEach((key, i) => {
      row[key] = (cols[i] ?? "").trim();
    });
    return row as unknown as Row;
  });
}

async function main() {
  const csvPath = join(process.cwd(), "Files", "catalog-seed.csv");
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  if (!rows.length) throw new Error(`No rows parsed from ${csvPath}`);

  const existing = await prisma.catalogItem.count();
  if (existing > 0 && process.env.RESEED !== "1") {
    console.log(`Catalog already has ${existing} item(s); skipping. Set RESEED=1 to wipe + reseed.`);
    return;
  }
  if (process.env.RESEED === "1") {
    await prisma.quoteLine.deleteMany();
    await prisma.quote.deleteMany();
    await prisma.catalogItem.deleteMany();
    console.log("RESEED=1 — cleared quotes + catalog.");
  }

  let created = 0;
  for (const r of rows) {
    const marginType = r.marginType === "FIXED" ? "FIXED" : "PERCENT";
    const marginValue = Number(r.marginValue);
    await prisma.catalogItem.create({
      data: {
        category: r.category || null,
        internalName: r.internalName,
        description: r.notes || null, // "HCN Recommended", "Configurable", etc.
        mfgPN: r.mfgPN || null,
        synnexSKU: r.synnexSKU || null,
        marginType,
        marginValue: Number.isFinite(marginValue) ? marginValue : 15,
        active: true,
      },
    });
    created++;
  }
  console.log(`Seeded ${created} catalog item(s) from catalog-seed.csv.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

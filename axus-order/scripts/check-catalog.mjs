// scripts/check-catalog.mjs
// Runs every catalog item through the live TD SYNNEX Price & Availability API and
// prints a status table (client-safe: shows status / availability / marked-up
// ballpark — never partner cost). Use it to verify the catalog before go-live.
//
//   node --env-file=.env scripts/check-catalog.mjs
import { PrismaClient } from "@prisma/client";

const TOKEN_URL = process.env.SYNNEX_TOKEN_URL ?? "https://sso.us.tdsynnex.com/oauth2/v1/token";
const API_BASE = process.env.SYNNEX_API_BASE ?? "https://api-uat.us.tdsynnex.com";
const VERSION = process.env.SYNNEX_PA_VERSION ?? "2.8";
const PRICE_TYPE = process.env.SYNNEX_PRICE_TYPE ?? "REGULAR";
const ROUND_UP = Number(process.env.BUDGET_ROUND_UP ?? "5");

const roundUp = (n) => (ROUND_UP > 0 ? Math.ceil(n / ROUND_UP) * ROUND_UP : Math.round(n * 100) / 100);

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.catalogItem.findMany({
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });
  await prisma.$disconnect();

  // Build queries (prefer synnexSKU, else mfgPN); track line -> item.
  const queries = [];
  const lineToItem = new Map();
  items.forEach((it, i) => {
    if (!it.synnexSKU && !it.mfgPN) return;
    const lineNumber = i + 1;
    lineToItem.set(lineNumber, it);
    queries.push({
      ...(it.synnexSKU ? { synnexSKU: String(it.synnexSKU) } : { mfgPN: it.mfgPN }),
      lineNumber,
      priceType: PRICE_TYPE,
    });
  });

  const tr = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SYNNEX_CLIENT_ID ?? "",
      client_secret: process.env.SYNNEX_CLIENT_SECRET ?? "",
    }),
  });
  const tj = await tr.json();
  if (!tr.ok) throw new Error("Token failed: " + JSON.stringify(tj));
  console.log(`Token OK. Querying ${queries.length} SKUs against ${API_BASE}\n`);

  const res = await fetch(`${API_BASE}/api/v1/webservice/json/GetPriceAvailability`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version: VERSION, skuList: queries }),
  });
  const data = await res.json();
  if (data.errorMessage) throw new Error("P&A error: " + data.errorMessage + " — " + (data.errorDetail ?? ""));

  // Best result per line (Active w/ price wins).
  const best = new Map();
  for (const it of data.PriceAvailabilityList ?? []) {
    const line = Number(it.lineNumber);
    const cost = it.price === "" || it.price == null ? null : Number(it.price);
    const cand = { status: it.status ?? "Unknown", cost, qty: Number(it.totalQuantity) || 0, desc: it.description ?? "" };
    const cur = best.get(line);
    const better = !cur || (cur.cost == null && cand.cost != null);
    if (better) best.set(line, cand);
  }

  const counts = { active: 0, unpriced: 0, noSku: 0 };
  const rows = [];
  items.forEach((it, i) => {
    const line = i + 1;
    if (!it.synnexSKU && !it.mfgPN) {
      counts.noSku++;
      rows.push([it.category, it.internalName, "—", "No SKU", "", ""]);
      return;
    }
    const r = best.get(line);
    if (!r) {
      counts.unpriced++;
      rows.push([it.category, it.internalName, it.synnexSKU ?? it.mfgPN, "Not found", "", ""]);
      return;
    }
    const quotable = r.status === "Active" && r.cost != null;
    if (quotable) counts.active++;
    else counts.unpriced++;
    const ballpark = quotable ? roundUp(r.cost * (1 + Number(it.marginValue) / 100)) : null;
    rows.push([
      it.category,
      it.internalName,
      it.synnexSKU ?? it.mfgPN,
      r.status,
      String(r.qty),
      ballpark == null ? "Contact us" : `~$${ballpark.toLocaleString()}`,
    ]);
  });

  // Print
  for (const [cat, name, sku, status, qty, bp] of rows) {
    console.log(
      `${(cat ?? "").slice(0, 18).padEnd(18)} ${name.slice(0, 42).padEnd(42)} ${String(sku).padEnd(18)} ${status.padEnd(16)} qty:${qty.padStart(4)}  ${bp}`
    );
  }
  console.log(
    `\nSummary: ${counts.active} priceable · ${counts.unpriced} not-priceable (discontinued/not-found/not-authorized) · ${counts.noSku} no-SKU (Contact us)`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Sandbox smoke test — verifies OAuth2 + Price & Availability end to end, no build step.
// Run it the moment your sandbox keys arrive:
//   SYNNEX_CLIENT_ID=xxx SYNNEX_CLIENT_SECRET=yyy node test-synnex.mjs 439866
// Optional env: SYNNEX_API_BASE, SYNNEX_PA_VERSION (2.8), SYNNEX_PRICE_TYPE (REGULAR)

const TOKEN_URL   = process.env.SYNNEX_TOKEN_URL   ?? "https://sso.us.tdsynnex.com/oauth2/v1/token";
const API_BASE    = process.env.SYNNEX_API_BASE    ?? "https://api-uat.us.tdsynnex.com";
const VERSION     = process.env.SYNNEX_PA_VERSION  ?? "2.8";
const PRICE_TYPE  = process.env.SYNNEX_PRICE_TYPE  ?? "REGULAR";
const CLIENT_ID     = process.env.SYNNEX_CLIENT_ID;
const CLIENT_SECRET = process.env.SYNNEX_CLIENT_SECRET;
const sku = process.argv[2] ?? "439866"; // Xerox imaging unit — the SKU from TD SYNNEX's own docs

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SYNNEX_CLIENT_ID and SYNNEX_CLIENT_SECRET first.");
  process.exit(1);
}

const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok) { console.error("Token failed", tokenRes.status, tokenJson); process.exit(1); }
console.log(`✓ Token OK (expires in ${tokenJson.expires_in}s). Querying SKU ${sku}...\n`);

const res = await fetch(`${API_BASE}/api/v1/webservice/json/GetPriceAvailability`, {
  method: "POST",
  headers: { Authorization: `Bearer ${tokenJson.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ version: VERSION, skuList: [{ synnexSKU: String(sku), lineNumber: 1, priceType: PRICE_TYPE }] }),
});
const data = await res.json();
if (!res.ok) { console.error("Request failed", res.status, JSON.stringify(data, null, 2)); process.exit(1); }

for (const it of data.PriceAvailabilityList ?? []) {
  console.log(`SKU ${it.synnexSKU}  [${it.status}]  ${it.description ?? ""}`);
  console.log(`  cost(partner): ${it.price ?? "n/a"}   msrp: ${it.msrp ?? "n/a"}   qtyAvail: ${it.totalQuantity ?? 0}`);
  for (const w of it.AvailabilityByWarehouse ?? []) {
    console.log(`   - WH ${w.warehouseInfo?.number} ${w.warehouseInfo?.city}: ${w.qty}`);
  }
}
console.log("\n✓ End-to-end path works.");

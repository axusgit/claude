// lib/synnex/mock.ts
// MockSynnexAdapter — same interface as RestSynnexAdapter, no network, no keys.
// Returns deterministic fake cost/availability so the app (and quotes) run and
// stay stable across restarts before real TD SYNNEX sandbox keys are added.
//
// Rules that mirror the real adapter's contract:
//   - A query with NEITHER a synnexSKU NOR an mfgPN is "Not found" (not quotable)
//     -> the quote shows "Contact us" (these are the configurable/"needs model" items).
//   - Anything with an identifier is "Active" with a deterministic cost.
// `cost` here is a fake PARTNER cost and, exactly like the real one, is server-only.
import type {
  SynnexAdapter,
  SkuQuery,
  PriceAvailability,
  Warehouse,
} from "./adapter";

// Stable string hash (djb2) -> non-negative integer.
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return h >>> 0;
}

const WAREHOUSES = [
  { number: 8, city: "Fremont, CA" },
  { number: 12, city: "Olathe, KS" },
  { number: 45, city: "Swedesboro, NJ" },
];

export class MockSynnexAdapter implements SynnexAdapter {
  async getPriceAvailability(items: SkuQuery[]): Promise<PriceAvailability[]> {
    return items.map((it, i) => {
      const lineNumber = it.lineNumber ?? i + 1;
      const key = (it.synnexSKU != null ? String(it.synnexSKU) : "") || it.mfgPN || "";

      // No identifier => cannot price it (configurable / "needs model" items).
      if (!key) {
        return {
          lineNumber,
          synnexSKU: it.synnexSKU != null ? String(it.synnexSKU) : null,
          mfgPN: it.mfgPN ?? null,
          mfgCode: null,
          description: null,
          status: "Not found",
          isQuotable: false,
          cost: null,
          priceType: it.priceType ?? "REGULAR",
          msrp: null,
          totalQuantity: 0,
          warehouses: [],
          weight: null,
          parcelShippable: null,
        };
      }

      const h = hash(key);
      // Deterministic fake partner cost, roughly $40–$2,040, cents from the hash.
      const cost = Math.round((40 + (h % 2000) + (h % 100) / 100) * 100) / 100;
      const msrp = Math.round(cost * 1.32 * 100) / 100; // list anchor above cost

      // Deterministic stock spread across 1–2 warehouses.
      const whCount = 1 + (h % 2);
      const warehouses: Warehouse[] = WAREHOUSES.slice(0, whCount).map((w, k) => ({
        number: w.number,
        city: w.city,
        zipcode: null,
        qty: (hash(key + ":" + k) % 40) + (k === 0 ? 3 : 0),
        onOrderQuantity: null,
        estimatedArrivalDate: null,
      }));
      const totalQuantity = warehouses.reduce((s, w) => s + w.qty, 0);

      return {
        lineNumber,
        synnexSKU:
          it.synnexSKU != null ? String(it.synnexSKU) : `MOCK-${h % 1_000_000}`,
        mfgPN: it.mfgPN ?? null,
        mfgCode: null,
        description: it.mfgPN
          ? `${it.mfgPN} (mock pricing)`
          : `SKU ${it.synnexSKU} (mock pricing)`,
        status: "Active",
        isQuotable: true,
        cost, // SERVER ONLY — never exposed past pricing.ts
        priceType: it.priceType ?? "REGULAR",
        msrp,
        totalQuantity,
        warehouses,
        weight: Math.round(((h % 500) / 100 + 0.5) * 100) / 100,
        parcelShippable: true,
      };
    });
  }
}

// lib/synnex/adapter.ts
// TD SYNNEX Partner API adapter — OAuth2 client-credentials + Price & Availability.
// SERVER-ONLY. `cost` is your partner (dealer) cost and must NEVER be sent to the browser.
// Generated against TD SYNNEX Partner API v1.0 OpenAPI spec.

export type PriceType =
  | "REGULAR" | "EDUCATION" | "PROMOTION" | "HEALTHCARE"
  | "FEDERALGOVERNMENT" | "STATEGOVERNMENT";

export interface SkuQuery {
  synnexSKU?: string | number;
  mfgPN?: string;
  customerPartNo?: string;
  priceType?: PriceType;
  lineNumber?: number; // assigned automatically if omitted
}

export interface Warehouse {
  number: number;
  city: string | null;
  zipcode: string | null;
  qty: number;
  onOrderQuantity?: number | null;
  estimatedArrivalDate?: string | null; // "YYYYMMDD"
}

export interface PriceAvailability {
  lineNumber: number;
  synnexSKU: string | null;
  mfgPN: string | null;
  mfgCode: string | null;
  description: string | null;
  status: string;          // "Active", "Inactive", "Discontinued", "Not found", "Not authorized", ...
  isQuotable: boolean;     // status === "Active" && cost != null
  cost: number | null;     // partner/dealer unit cost — SERVER ONLY, never expose
  priceType: string | null;
  msrp: number | null;     // list price (v2.8+) — safe to show as an anchor
  totalQuantity: number;
  warehouses: Warehouse[];
  weight: number | null;         // v2.8+
  parcelShippable: boolean | null; // v2.8+
}

export interface SynnexAdapter {
  getPriceAvailability(items: SkuQuery[]): Promise<PriceAvailability[]>;
}

// Turn an item's identifiers into a P&A query. A manual override (synnexSKU field)
// may hold EITHER a numeric TD SYNNEX SKU or a manufacturer part number (e.g. CDW's
// "Mfg. Part #") — numeric is queried as a SKU, anything else as a mfgPN. Falls
// back to the catalog mfgPN.
export function idQuery(
  synnexSKU?: string | null,
  mfgPN?: string | null
): { synnexSKU?: string; mfgPN?: string } {
  const s = synnexSKU?.trim();
  if (s) return /^\d+$/.test(s) ? { synnexSKU: s } : { mfgPN: s };
  const m = mfgPN?.trim();
  if (m) return { mfgPN: m };
  return {};
}

interface SynnexConfig {
  tokenUrl: string;
  apiBase: string;
  clientId: string;
  clientSecret: string;
  paVersion: string;
  defaultPriceType: PriceType;
}

function loadConfig(): SynnexConfig {
  const env = process.env;
  const cfg: SynnexConfig = {
    tokenUrl: env.SYNNEX_TOKEN_URL ?? "https://sso.us.tdsynnex.com/oauth2/v1/token",
    apiBase: env.SYNNEX_API_BASE ?? "https://api-uat.us.tdsynnex.com", // sandbox US
    clientId: env.SYNNEX_CLIENT_ID ?? "",
    clientSecret: env.SYNNEX_CLIENT_SECRET ?? "",
    paVersion: env.SYNNEX_PA_VERSION ?? "2.8",
    defaultPriceType: (env.SYNNEX_PRICE_TYPE as PriceType) ?? "REGULAR",
  };
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("SYNNEX_CLIENT_ID / SYNNEX_CLIENT_SECRET are not set");
  }
  return cfg;
}

// ---- token cache (module-scoped; fine for a single-process Lightsail node) ----
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(cfg: SynnexConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `TD SYNNEX token request failed (${res.status}): ${json.error_description || json.error || res.statusText}`
    );
  }
  const ttlMs = (Number(json.expires_in) || 7200) * 1000;
  tokenCache = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

// ---- helpers ----
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Last-good price cache (per SKU key). TD SYNNEX's P&A occasionally returns a
// transient "Server.RuntimeError"; without this, one hiccup blanks the whole
// catalog to "Contact us". We retry, then fall back to the last good price.
const PA_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h
const paCache = new Map<string, { pa: PriceAvailability; at: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function skuKey(it: SkuQuery): string | null {
  if (it.synnexSKU != null && it.synnexSKU !== "") return "s:" + String(it.synnexSKU);
  if (it.mfgPN) return "m:" + it.mfgPN;
  return null;
}

export class RestSynnexAdapter implements SynnexAdapter {
  private cfg: SynnexConfig;
  constructor(cfg?: Partial<SynnexConfig>) {
    this.cfg = { ...loadConfig(), ...cfg };
  }

  async getPriceAvailability(items: SkuQuery[]): Promise<PriceAvailability[]> {
    if (!items.length) return [];
    // Stable, unique line numbers so responses can be matched back to requests
    // (one mfgPN can expand to multiple SKUs, so never match on SKU alone).
    const withLines = items.map((it, i) => ({ ...it, lineNumber: it.lineNumber ?? i + 1 }));

    const results: PriceAvailability[] = [];
    for (const batch of chunk(withLines, 50)) {
      // Dedupe identical identifiers: TD SYNNEX collapses duplicate SKUs/mfgPNs in a
      // single request (echoing only the first line), so we query each once and fan
      // the result back to every line that asked for it.
      const byKey = new Map<string, { rep: (typeof batch)[number]; lines: number[] }>();
      for (const it of batch) {
        const k = skuKey(it);
        if (!k) continue;
        const g = byKey.get(k);
        if (g) g.lines.push(it.lineNumber);
        else byKey.set(k, { rep: it, lines: [it.lineNumber] });
      }
      const list = await this.callPA([...byKey.values()].map((g) => g.rep));

      if (list) {
        // The response is keyed by each representative line number.
        const repLineToKey = new Map<number, string>();
        for (const [k, g] of byKey) repLineToKey.set(g.rep.lineNumber, k);
        const bestByKey = new Map<string, PriceAvailability>();
        for (const item of list) {
          const pa = normalize(item);
          const k = repLineToKey.get(pa.lineNumber);
          if (!k) continue;
          const cur = bestByKey.get(k);
          if (!cur || (!cur.isQuotable && pa.isQuotable)) bestByKey.set(k, pa);
        }
        for (const [k, g] of byKey) {
          const pa = bestByKey.get(k);
          if (!pa) continue;
          for (const ln of g.lines) results.push({ ...pa, lineNumber: ln });
          if (pa.isQuotable) paCache.set(k, { pa, at: Date.now() });
        }
      } else {
        // Transient failure after retries — serve last-good cached prices.
        for (const it of batch) {
          const key = skuKey(it);
          const c = key ? paCache.get(key) : undefined;
          if (c && Date.now() - c.at < PA_CACHE_TTL) {
            results.push({ ...c.pa, lineNumber: it.lineNumber });
          }
        }
      }
    }
    return results;
  }

  // Calls GetPriceAvailability with retries; returns the PriceAvailabilityList on
  // success, or null after exhausting retries (transient error / network).
  private async callPA(
    batch: (SkuQuery & { lineNumber: number })[]
  ): Promise<unknown[] | null> {
    const url = `${this.cfg.apiBase}/api/v1/webservice/json/GetPriceAvailability`;
    const payload = {
      version: this.cfg.paVersion,
      skuList: batch.map((it) => ({
        ...(it.synnexSKU != null ? { synnexSKU: String(it.synnexSKU) } : {}),
        ...(it.mfgPN ? { mfgPN: it.mfgPN } : {}),
        ...(it.customerPartNo ? { customerPartNo: it.customerPartNo } : {}),
        lineNumber: it.lineNumber,
        priceType: it.priceType ?? this.cfg.defaultPriceType,
      })),
    };
    const body = JSON.stringify(payload);

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        let token = await getAccessToken(this.cfg);
        let res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body,
        });
        if (res.status === 401) {
          tokenCache = null;
          token = await getAccessToken(this.cfg);
          res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body,
          });
        }
        const json: any = await res.json().catch(() => ({}));
        // Success only when the list is present and no transient error is reported.
        if (res.ok && Array.isArray(json?.PriceAvailabilityList) && !json?.errorMessage) {
          return json.PriceAvailabilityList;
        }
        // else: transient (Server.RuntimeError / empty) — fall through to retry.
      } catch {
        // network error — retry
      }
      if (attempt < 3) await sleep(400 * (attempt + 1)); // 0.4s, 0.8s, 1.2s
    }
    return null;
  }
}

function normalize(item: any): PriceAvailability {
  const warehouses: Warehouse[] = (item.AvailabilityByWarehouse ?? []).map((w: any) => ({
    number: toNum(w?.warehouseInfo?.number) ?? -1,
    city: w?.warehouseInfo?.city ?? null,
    zipcode: w?.warehouseInfo?.zipcode != null ? String(w.warehouseInfo.zipcode) : null,
    qty: toNum(w?.qty) ?? 0,
    onOrderQuantity: toNum(w?.onOrderQuantity),
    estimatedArrivalDate: w?.estimatedArrivalDate ?? null,
  }));
  const cost = toNum(item.price); // <- partner COST, string in the payload, null if not Active
  const status = item.status ?? "Unknown";
  return {
    lineNumber: toNum(item.lineNumber) ?? -1,
    synnexSKU: item.synnexSKU != null ? String(item.synnexSKU) : null,
    mfgPN: item.mfgPN ?? null,
    mfgCode: item.mfgCode != null ? String(item.mfgCode) : null,
    description: item.description ?? null,
    status,
    isQuotable: status === "Active" && cost != null,
    cost,
    priceType: item.priceType ?? null,
    msrp: toNum(item.msrp),
    totalQuantity: toNum(item.totalQuantity) ?? 0,
    warehouses,
    weight: toNum(item.weight),
    parcelShippable: item.parcelShippable == null ? null : item.parcelShippable === "Y",
  };
}

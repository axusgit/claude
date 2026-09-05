// app/admin/catalog/page.tsx
// Admin-only catalog reference table: every item, its SKU (mfgPN), and LIVE status
// from the pricing source (mock now; authoritative TD SYNNEX when SYNNEX_ADAPTER=real).
// Client-safe: shows status / availability / ballpark only — never partner cost.
import { prisma } from "@/lib/prisma";
import { getIdentity, roleOf } from "@/lib/auth";
import { getAdapter } from "@/lib/synnex";
import { toBallpark, type MarginRule } from "@/lib/synnex/pricing";
import type { SkuQuery, PriceAvailability } from "@/lib/synnex/adapter";
import Link from "next/link";

export const dynamic = "force-dynamic";

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const approx = (n: number) => `~${usd0(n)}`;

// --- "closest item" helpers for the Replacement column ---
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  );
}
// Jaccard similarity of the two names' word sets (0..1).
function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export default async function AdminCatalogPage() {
  const identity = await getIdentity();
  const isAdmin = identity ? roleOf(identity) === "admin" : false;
  if (!isAdmin) {
    return (
      <div className="glass mx-auto max-w-lg rounded-xl p-8 text-center">
        <h1 className="font-display text-lg font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted">
          The catalog status view is restricted to administrators.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to catalog
        </Link>
      </div>
    );
  }

  const items = await prisma.catalogItem.findMany({
    orderBy: [{ category: "asc" }, { internalName: "asc" }],
  });

  // Query the pricing source for every item that has an identifier.
  const queries: SkuQuery[] = [];
  const lineToItemId = new Map<number, string>();
  items.forEach((it, i) => {
    if (!it.synnexSKU && !it.mfgPN) return;
    const lineNumber = i + 1;
    lineToItemId.set(lineNumber, it.id);
    queries.push({
      synnexSKU: it.synnexSKU ?? undefined,
      mfgPN: it.synnexSKU ? undefined : it.mfgPN ?? undefined,
      lineNumber,
    });
  });

  let paByItemId = new Map<string, PriceAvailability>();
  let sourceError: string | null = null;
  try {
    const pa = queries.length ? await getAdapter().getPriceAvailability(queries) : [];
    const best = new Map<number, PriceAvailability>();
    for (const r of pa) {
      const cur = best.get(r.lineNumber);
      if (!cur || (!cur.isQuotable && r.isQuotable)) best.set(r.lineNumber, r);
    }
    for (const [line, r] of best) {
      const id = lineToItemId.get(line);
      if (id) paByItemId.set(id, r);
    }
  } catch (e) {
    sourceError = e instanceof Error ? e.message : "Pricing source error";
  }

  const adapterMode = (process.env.SYNNEX_ADAPTER ?? "mock").toLowerCase();

  const rows = items.map((it) => {
    const pa = paByItemId.get(it.id);
    let statusLabel: string;
    let tone: "ok" | "warn" | "muted";
    let ballpark: number | null = null;
    let qty: number | null = null;

    if (!it.synnexSKU && !it.mfgPN) {
      statusLabel = "No SKU";
      tone = "muted";
    } else if (!pa) {
      statusLabel = sourceError ? "Source error" : "Not found";
      tone = "warn";
    } else {
      statusLabel = pa.status;
      tone = pa.status === "Active" && pa.isQuotable ? "ok" : "warn";
      qty = pa.totalQuantity;
      const rule: MarginRule = {
        type: it.marginType as "PERCENT" | "FIXED",
        value: it.marginValue,
      };
      ballpark = toBallpark(pa, rule).unitBallpark;
    }

    return {
      id: it.id,
      category: it.category ?? "Other",
      name: it.internalName,
      sku: it.mfgPN ?? it.synnexSKU ?? "—",
      statusLabel,
      tone,
      ballpark,
      qty,
      notes: it.description ?? "",
    };
  });

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.tone === "ok").length,
    noSku: rows.filter((r) => r.statusLabel === "No SKU").length,
  };

  // For each unavailable item, the closest AVAILABLE item in the same category.
  const available = rows.filter((r) => r.tone === "ok");
  function replacementFor(r: (typeof rows)[number]) {
    if (r.tone === "ok") return null; // it's available itself
    const sameCat = available.filter((a) => a.category === r.category && a.id !== r.id);
    if (!sameCat.length) return null;
    let best = sameCat[0];
    let bestScore = similarity(r.name, best.name);
    for (const c of sameCat.slice(1)) {
      const s = similarity(r.name, c.name);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Catalog <span className="grad-text">Status</span>
        </h1>
        <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
          ← Back to catalog
        </Link>
      </div>
      <p className="mb-5 text-sm text-muted">
        {counts.total} items · {counts.active} active · {counts.noSku} without a SKU.
        Status &amp; availability are live from the pricing source
        {adapterMode === "real" ? " (third-party distributor)." : " — sample data (mock adapter)."}
      </p>

      {sourceError && (
        <div className="mb-4 rounded-md border border-line bg-accent-soft px-4 py-2 text-sm text-warn">
          Pricing source error: {sourceError}
        </div>
      )}

      <div className="glass overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">SKU (mfgPN)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Avail.</th>
                <th className="px-4 py-3 text-right font-medium">Unit (approx.)</th>
                <th className="px-4 py-3 font-medium">Replacement</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-glow border-b border-line/70 align-top last:border-0">
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">{r.category}</td>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-faint whitespace-nowrap">
                    {r.sku}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge label={r.statusLabel} tone={r.tone} />
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-muted">
                    {r.qty == null ? "—" : r.qty}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {r.ballpark == null ? (
                      <span className="text-warn">Contact us</span>
                    ) : (
                      approx(r.ballpark)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {(() => {
                      const rep = replacementFor(r);
                      if (r.tone === "ok") return <span className="text-faint">—</span>;
                      if (!rep) return <span className="text-faint">No in-category match</span>;
                      return (
                        <span className="text-ink">
                          {rep.name}
                          {rep.sku !== "—" && (
                            <span className="ml-1 font-mono text-[10px] text-faint">
                              {rep.sku}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "muted";
}) {
  const styles =
    tone === "ok"
      ? "border-ok/40 bg-ok/10 text-ok"
      : tone === "warn"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-line bg-white/[0.03] text-faint";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

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

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default async function AdminCatalogPage() {
  const identity = await getIdentity();
  const isAdmin = identity ? roleOf(identity) === "admin" : false;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">Admins only</h1>
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

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Catalog Status</h1>
        <Link href="/" className="text-sm text-muted hover:text-ink transition-colors">
          ← Back to catalog
        </Link>
      </div>
      <p className="mb-5 text-sm text-muted">
        {counts.total} items · {counts.active} active · {counts.noSku} without a SKU.
        Status &amp; availability are live from the pricing source
        {adapterMode === "real" ? " (TD SYNNEX)." : " — sample data (mock adapter)."}
      </p>

      {sourceError && (
        <div className="mb-4 rounded-md border border-line bg-accent-soft px-4 py-2 text-sm text-warn">
          Pricing source error: {sourceError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">SKU (mfgPN)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Avail.</th>
                <th className="px-4 py-3 text-right font-medium">Unit (ballpark)</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
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
                      usd(r.ballpark)
                    )}
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
      ? "bg-green-50 text-green-700 border-green-200"
      : tone === "warn"
        ? "bg-accent-soft text-warn border-line"
        : "bg-canvas text-faint border-line";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

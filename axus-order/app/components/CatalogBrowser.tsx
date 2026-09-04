"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface CatalogCardItem {
  id: string;
  category: string;
  internalName: string;
  description: string | null;
  mfgPN: string | null;
  synnexSKU: string | null;
}

type Cart = Record<string, number>;
const CART_KEY = "axus-order-cart";

export function CatalogBrowser({ catalog }: { catalog: CatalogCardItem[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({});
  const [active, setActive] = useState<string>("All");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  const categories = useMemo(
    () => Array.from(new Set(catalog.map((c) => c.category))).sort(),
    [catalog]
  );

  const grouped = useMemo(() => {
    const shown = active === "All" ? categories : [active];
    return shown.map((cat) => ({
      category: cat,
      items: catalog.filter((c) => c.category === cat),
    }));
  }, [catalog, categories, active]);

  const lineCount = Object.keys(cart).length;
  const unitCount = Object.values(cart).reduce((a, b) => a + b, 0);

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  async function getQuote() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart: Object.entries(cart).map(([catalogItemId, qty]) => ({
            catalogItemId,
            qty,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not build quote");
      try {
        localStorage.removeItem(CART_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/quote/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="pb-28">
      <div className="mb-7">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan-soft px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-cyan">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
          Live TD SYNNEX pricing
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Hardware <span className="grad-text">Catalog</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Select the equipment you need and set quantities. Generate a ballpark
          quote when you&rsquo;re ready — indicative, non-binding, no obligation.
        </p>
      </div>

      {/* Category filter chips */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Chip label="All" active={active === "All"} onClick={() => setActive("All")} />
        {categories.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            active={active === cat}
            onClick={() => setActive(cat)}
          />
        ))}
      </div>

      {/* Category tables */}
      <div className="space-y-9">
        {grouped.map(({ category, items }) => (
          <section key={category}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.15em] text-cyan">
                {category}
              </h2>
              <span className="hairline flex-1 opacity-60" />
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-faint">
                {items.length}
              </span>
            </div>
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium">Part No.</th>
                      <th className="px-4 py-3 text-right font-medium">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const partNo = item.mfgPN ?? item.synnexSKU;
                      const qty = cart[item.id] ?? 0;
                      return (
                        <tr
                          key={item.id}
                          className={
                            "row-glow border-b border-line/70 align-top last:border-0 " +
                            (qty > 0 ? "bg-accent-soft/40" : "")
                          }
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium leading-snug text-ink">
                              {item.internalName}
                            </div>
                            {item.description && (
                              <div className="mt-0.5 text-xs text-muted">
                                {item.description}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            {partNo ? (
                              <span className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-cyan/90">
                                {partNo}
                              </span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <div className="flex justify-end">
                              {qty <= 0 ? (
                                <button
                                  onClick={() => setQty(item.id, 1)}
                                  className="rounded-lg border border-line bg-white/[0.02] px-3.5 py-1.5 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent hover:shadow-[0_0_16px_-6px_rgba(255,122,61,0.8)]"
                                >
                                  Add
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <QtyBtn label="−" onClick={() => setQty(item.id, qty - 1)} />
                                  <input
                                    type="number"
                                    min={0}
                                    value={qty}
                                    onChange={(e) =>
                                      setQty(
                                        item.id,
                                        Math.max(0, Math.floor(Number(e.target.value) || 0))
                                      )
                                    }
                                    className="tabular w-12 rounded-lg border border-line bg-canvas/60 py-1 text-center text-sm text-ink outline-none focus:border-accent"
                                  />
                                  <QtyBtn label="+" onClick={() => setQty(item.id, qty + 1)} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Sticky cart bar */}
      {lineCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30">
          <div className="hairline" />
          <div className="bg-canvas/80 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
              <div className="text-sm">
                <span className="font-display font-semibold text-ink">{lineCount}</span>{" "}
                <span className="text-muted">
                  {lineCount === 1 ? "item" : "items"} · {unitCount} unit
                  {unitCount === 1 ? "" : "s"}
                </span>
                {error && <span className="ml-3 text-warn">{error}</span>}
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setCart({})}
                  className="text-sm text-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
                <button
                  onClick={getQuote}
                  disabled={submitting}
                  className="btn-accent rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {submitting ? "Building quote…" : "Get Quote →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all " +
        (active
          ? "border-accent/60 bg-accent-soft text-accent shadow-[0_0_16px_-6px_rgba(255,122,61,0.8)]"
          : "border-line bg-white/[0.02] text-muted hover:border-white/20 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}

function QtyBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.02] text-base leading-none text-muted transition-all hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}

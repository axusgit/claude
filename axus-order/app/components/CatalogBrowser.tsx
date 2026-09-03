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

  // Load / persist cart (per-browser convenience only).
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Hardware Catalog</h1>
        <p className="mt-1 text-sm text-muted">
          Choose the equipment you need and add quantities. Request a ballpark
          quote when you&rsquo;re ready — no obligation.
        </p>
      </div>

      {/* Category filter chips */}
      <div className="mb-7 flex flex-wrap gap-2">
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

      {/* Category sections */}
      <div className="space-y-10">
        {grouped.map(({ category, items }) => (
          <section key={category}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                {category}
              </h2>
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs text-faint">{items.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  qty={cart[item.id] ?? 0}
                  onSetQty={(q) => setQty(item.id, q)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Sticky cart bar */}
      {lineCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <div className="text-sm">
              <span className="font-semibold">{lineCount}</span>{" "}
              <span className="text-muted">
                {lineCount === 1 ? "item" : "items"} · {unitCount} unit
                {unitCount === 1 ? "" : "s"}
              </span>
              {error && <span className="ml-3 text-warn">{error}</span>}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCart({})}
                className="text-sm text-muted hover:text-ink transition-colors"
              >
                Clear
              </button>
              <button
                onClick={getQuote}
                disabled={submitting}
                className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? "Building quote…" : "Get Quote →"}
              </button>
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
        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors " +
        (active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line bg-surface text-muted hover:text-ink")
      }
    >
      {label}
    </button>
  );
}

function ProductCard({
  item,
  qty,
  onSetQty,
}: {
  item: CatalogCardItem;
  qty: number;
  onSetQty: (q: number) => void;
}) {
  const partNo = item.mfgPN ?? item.synnexSKU;
  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface p-4 transition-shadow hover:shadow-sm">
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">{item.internalName}</h3>
          {partNo && (
            <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">
              {partNo}
            </span>
          )}
        </div>
        {item.description && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.description}</p>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        {qty <= 0 ? (
          <button
            onClick={() => onSetQty(1)}
            className="w-full rounded-md border border-line bg-surface py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Add to cart
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <QtyBtn label="−" onClick={() => onSetQty(qty - 1)} />
              <input
                type="number"
                min={0}
                value={qty}
                onChange={(e) => onSetQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="tabular w-12 rounded-md border border-line bg-surface py-1 text-center text-sm"
              />
              <QtyBtn label="+" onClick={() => onSetQty(qty + 1)} />
            </div>
            <button
              onClick={() => onSetQty(0)}
              className="text-xs text-muted hover:text-warn transition-colors"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QtyBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-base leading-none text-muted transition-colors hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}

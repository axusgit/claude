"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DISCLAIMER_TITLE, DISCLAIMER_TEXT, REQUIREMENTS_NOTE } from "@/lib/disclaimer";

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const approx = (n: number) => `~${usd0(n)}`;

// --- "closest available item" helpers for the Suggested Alternative column ---
function nameTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  );
}
function similarity(a: string, b: string): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface CatalogCardItem {
  id: string;
  category: string;
  internalName: string;
  description: string | null;
  partNo: string | null;
  unitPrice: number | null;
  // Admin-defined replacement part offered when the original can't be priced.
  replacementName: string | null;
  replacementPartNo: string | null;
  replacementPrice: number | null;
}

type Cart = Record<string, number>;
const CART_KEY = "axus-order-cart";
// Per-item flag: the customer accepted the replacement part for this item.
const REPLACE_KEY = "axus-order-replacements";
// Once the terms are accepted on the first generated quote, we remember it here
// so returning shoppers aren't re-prompted on every subsequent quote.
const DISCLAIMER_KEY = "axus-order-disclaimer-accepted";
// The site is open (no login), so we capture the customer's details once on the
// first quote and reuse them for subsequent quotes in the same browser.
const CUSTOMER_KEY = "axus-order-customer";

interface Customer {
  name: string;
  email: string;
  company: string;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CatalogBrowser({ catalog }: { catalog: CatalogCardItem[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({});
  const [active, setActive] = useState<string>("All");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // Whether the customer has already accepted the terms on a prior quote.
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  // Slide-over cart panel + captured customer details.
  const [cartOpen, setCartOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", company: "" });
  // Items for which the customer accepted the replacement part.
  const [repAccepted, setRepAccepted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
      if (localStorage.getItem(DISCLAIMER_KEY) === "1") setDisclaimerAccepted(true);
      const cust = localStorage.getItem(CUSTOMER_KEY);
      if (cust) setCustomer((c) => ({ ...c, ...JSON.parse(cust) }));
      const rep = localStorage.getItem(REPLACE_KEY);
      if (rep) setRepAccepted(JSON.parse(rep));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(REPLACE_KEY, JSON.stringify(repAccepted));
    } catch {
      /* ignore */
    }
  }, [repAccepted]);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  // Hide the fixed theme toggle while the cart panel or disclaimer is open so it
  // doesn't overlap the panel's close button.
  useEffect(() => {
    const open = cartOpen || showDisclaimer;
    document.body.classList.toggle("ro-overlay-open", open);
    return () => document.body.classList.remove("ro-overlay-open");
  }, [cartOpen, showDisclaimer]);

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

  // For each unpriceable item, the closest AVAILABLE item in the same category.
  const replacementById = useMemo(() => {
    const available = catalog.filter((c) => c.unitPrice != null);
    const map = new Map<string, CatalogCardItem>();
    for (const it of catalog) {
      if (it.unitPrice != null) continue;
      const sameCat = available.filter((a) => a.category === it.category && a.id !== it.id);
      if (!sameCat.length) continue;
      let best = sameCat[0];
      let bestScore = similarity(it.internalName, best.internalName);
      for (const c of sameCat.slice(1)) {
        const s = similarity(it.internalName, c.internalName);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      map.set(it.id, best);
    }
    return map;
  }, [catalog]);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: catalogById.get(id), qty }))
        .filter((l): l is { item: CatalogCardItem; qty: number } => !!l.item),
    [cart, catalogById]
  );
  // Counts reflect only items that still exist in the catalog — never stale IDs
  // left in localStorage (e.g. after a catalog update), which would otherwise
  // show a phantom cart badge that can't be cleared.
  const lineCount = cartLines.length;
  const unitCount = cartLines.reduce((a, l) => a + l.qty, 0);

  // Drop cart entries whose catalog item no longer exists.
  useEffect(() => {
    setCart((prev) => {
      const valid = Object.fromEntries(
        Object.entries(prev).filter(([id]) => catalogById.has(id))
      );
      return Object.keys(valid).length === Object.keys(prev).length ? prev : valid;
    });
  }, [catalogById]);
  // Effective unit price honors an accepted replacement.
  const effPrice = (it: CatalogCardItem) =>
    repAccepted[it.id] && it.replacementPrice != null ? it.replacementPrice : it.unitPrice;
  const cartSubtotal = useMemo(
    () =>
      cartLines.reduce((s, l) => {
        const p = effPrice(l.item);
        return s + (p != null ? p * l.qty : 0);
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cartLines, repAccepted]
  );

  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  // Fresh start: empty the cart + accepted alternatives and reset the disclaimer
  // acceptance so the legal message is shown again on the next quote.
  function startNewQuote() {
    setCart({});
    setRepAccepted({});
    setDisclaimerAccepted(false);
    setCartOpen(false);
    try {
      localStorage.removeItem(DISCLAIMER_KEY);
    } catch {
      /* ignore */
    }
  }

  const customerReady =
    customer.name.trim() !== "" &&
    EMAIL_RE.test(customer.email.trim()) &&
    customer.company.trim() !== "";

  function openDisclaimer() {
    setError(null);
    setCartOpen(false);
    // Only show the disclaimer the first time — if the customer has already
    // accepted the terms AND we have their details, generate straight away.
    if (disclaimerAccepted && customerReady) {
      submitQuote();
      return;
    }
    setAccepted(false);
    setShowDisclaimer(true);
  }

  async function submitQuote() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: true,
          customer: {
            name: customer.name.trim(),
            email: customer.email.trim(),
            company: customer.company.trim(),
          },
          cart: Object.entries(cart).map(([catalogItemId, qty]) => ({
            catalogItemId,
            qty,
            useReplacement: !!repAccepted[catalogItemId],
          })),
        }),
      });
      // Robust: never assume a JSON body (a failed request can be empty).
      let data: { id?: string; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON / empty body */
      }
      if (!res.ok)
        throw new Error(data?.error ?? `Could not build quote (error ${res.status}).`);
      if (!data?.id)
        throw new Error("Unexpected response from the server. Please try again.");
      // Remember that the terms were accepted so future quotes skip the modal.
      // Keep the cart intact so the customer can keep shopping and their
      // already-added items remain when they come back.
      try {
        localStorage.setItem(DISCLAIMER_KEY, "1");
        localStorage.setItem(
          CUSTOMER_KEY,
          JSON.stringify({
            name: customer.name.trim(),
            email: customer.email.trim(),
            company: customer.company.trim(),
          })
        );
      } catch {
        /* ignore */
      }
      setDisclaimerAccepted(true);
      router.push(`/quote/${data.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(msg);
      setSubmitting(false);
      // Re-open the details modal so the customer can correct a rejected email.
      setShowDisclaimer(true);
    }
  }

  return (
    <div className="pb-28">
      <div className="mb-8">
        <div className="glass flex w-full flex-wrap items-center justify-center gap-6 rounded-2xl px-8 py-5">
          <span className="text-xs font-medium uppercase tracking-[0.15em] text-faint">
            A collaboration between
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/axus-logo.png" alt="Axus Technologies" className="axus-logo h-[60px] w-auto" />
          <span className="text-3xl font-light text-faint">+</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hcn-logo.svg" alt="Health Choice Network" className="hcn-logo h-12 w-auto" />
          <span className="h-10 w-px bg-line" />
          <span className="font-display text-xl font-semibold text-ink">EPIC Readiness</span>
        </div>
        <h1 className="mt-6 text-center font-display text-3xl font-semibold tracking-tight">
          Hardware <span className="grad-text">Catalog</span>
        </h1>
      </div>

      {/* Epic go-live required-peripheral callout */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 px-5 py-4">
        <span className="mt-0.5 shrink-0 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent">
          Required
        </span>
        <p className="text-sm leading-relaxed text-muted">{REQUIREMENTS_NOTE}</p>
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
                <table className="w-full table-fixed text-base">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="w-[34%] px-4 py-3 font-medium">Item</th>
                      <th className="w-[14%] px-4 py-3 font-medium">Part No.</th>
                      <th className="w-[13%] px-4 py-3 text-right font-medium">Unit Price</th>
                      <th className="w-[22%] px-4 py-3 font-medium">Suggested Alternative</th>
                      <th className="w-[17%] px-4 py-3 text-right font-medium">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const partNo = item.partNo;
                      const qty = cart[item.id] ?? 0;
                      return (
                        <tr
                          key={item.id}
                          className={
                            "row-glow border-b border-line/70 align-top last:border-0 " +
                            (qty > 0 ? "bg-accent-soft/40" : "")
                          }
                        >
                          <td className="px-4 py-4">
                            <div className="text-base font-semibold leading-snug text-ink">
                              {item.internalName}
                            </div>
                            {item.description && (
                              <div className="mt-1 text-sm leading-relaxed text-muted">
                                {item.description}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            {partNo ? (
                              <span className="inline-block break-all rounded border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-cyan/90">
                                {partNo}
                              </span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right align-middle">
                            {(() => {
                              const p = effPrice(item);
                              if (p == null)
                                return <span className="text-xs text-warn">Not available</span>;
                              return (
                                <span className="tabular text-ink">
                                  {approx(p)}
                                  {repAccepted[item.id] && item.replacementPrice != null && (
                                    <span className="ml-1 text-[10px] text-cyan">(repl.)</span>
                                  )}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 align-middle text-sm">
                            {(() => {
                              const hasManual =
                                !!item.replacementPartNo && item.replacementPrice != null;
                              // Manual admin-defined successor part — accept via checkbox.
                              if (item.unitPrice == null && hasManual) {
                                const repLabel = item.replacementName || item.replacementPartNo;
                                return (
                                  <label className="flex cursor-pointer items-start gap-2 leading-snug">
                                    <input
                                      type="checkbox"
                                      checked={!!repAccepted[item.id]}
                                      onChange={(e) =>
                                        setRepAccepted((a) => ({
                                          ...a,
                                          [item.id]: e.target.checked,
                                        }))
                                      }
                                      className="mt-0.5 h-4 w-4 accent-[#ff7a3d]"
                                    />
                                    <span>
                                      <span className="text-cyan">Use {repLabel}</span>
                                      {item.replacementPrice != null && (
                                        <span className="ml-1 text-faint">
                                          ({approx(item.replacementPrice)})
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                );
                              }
                              // Fall back to the closest available in-category alternative.
                              if (item.unitPrice == null) {
                                const rep = replacementById.get(item.id);
                                if (!rep) return <span className="text-faint">—</span>;
                                return (
                                  <button
                                    onClick={() => setQty(rep.id, (cart[rep.id] ?? 0) + 1)}
                                    title="Add this available alternative to your quote"
                                    className="text-left leading-snug text-cyan transition-colors hover:text-accent hover:underline"
                                  >
                                    {rep.internalName}
                                    {rep.unitPrice != null && (
                                      <span className="ml-1 text-faint">
                                        ({approx(rep.unitPrice)})
                                      </span>
                                    )}
                                  </button>
                                );
                              }
                              return <span className="text-faint">—</span>;
                            })()}
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
                  onClick={openDisclaimer}
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

      {/* Cart icon — click to view what's in the cart */}
      <button
        onClick={() => setCartOpen(true)}
        aria-label="View cart"
        className="glass fixed right-16 top-4 z-40 flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent"
      >
        <CartIcon />
        <span className="tabular font-display">{unitCount}</span>
      </button>

      {/* Cart slide-over panel */}
      {cartOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <div className="glass absolute right-0 top-0 flex h-full w-full max-w-sm flex-col rounded-none border-l border-line p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                Your <span className="grad-text">Cart</span>
              </h2>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition-all hover:border-accent hover:text-accent"
              >
                ✕
              </button>
            </div>

            {cartLines.length === 0 ? (
              <div className="mt-10 text-center text-sm text-muted">
                Your cart is empty. Add items from the catalog to build a quote.
              </div>
            ) : (
              <>
                <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                  {cartLines.map(({ item, qty }) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-line bg-white/[0.02] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">
                            {item.internalName}
                          </div>
                          {repAccepted[item.id] && item.replacementPrice != null && (
                            <div className="mt-0.5 truncate text-[11px] text-cyan">
                              → replacement: {item.replacementName || item.replacementPartNo}
                            </div>
                          )}
                          <div className="mt-0.5 text-xs text-muted">
                            {(() => {
                              const p = effPrice(item);
                              if (p == null) return <span className="text-warn">Not available</span>;
                              return (
                                <>
                                  {approx(p)} ea ·{" "}
                                  <span className="text-ink">{approx(p * qty)}</span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <button
                          onClick={() => setQty(item.id, 0)}
                          aria-label="Remove item"
                          className="shrink-0 text-xs text-muted transition-colors hover:text-warn"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <QtyBtn label="−" onClick={() => setQty(item.id, qty - 1)} />
                        <input
                          type="number"
                          min={0}
                          value={qty}
                          onChange={(e) =>
                            setQty(item.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))
                          }
                          className="tabular w-12 rounded-lg border border-line bg-canvas/60 py-1 text-center text-sm text-ink outline-none focus:border-accent"
                        />
                        <QtyBtn label="+" onClick={() => setQty(item.id, qty + 1)} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Subtotal (approx., priced items)</span>
                    <span className="font-display text-lg font-semibold text-accent">
                      {approx(cartSubtotal)}
                    </span>
                  </div>
                  {error && <p className="mt-2 text-sm text-warn">{error}</p>}
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => setCart({})}
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      Clear
                    </button>
                    <button
                      onClick={startNewQuote}
                      title="Empty the cart and start a brand new quote"
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      Start new
                    </button>
                    <button
                      onClick={openDisclaimer}
                      disabled={submitting}
                      className="btn-accent ml-auto rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                      {submitting ? "Building quote…" : "Get Quote →"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Disclaimer acceptance modal */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !submitting && setShowDisclaimer(false)}
          />
          <div className="glass relative z-10 w-full max-w-lg rounded-2xl p-6">
            <h2 className="font-display text-lg font-semibold">{DISCLAIMER_TITLE}</h2>
            <div className="mt-3 max-h-[38vh] overflow-y-auto whitespace-pre-line rounded-lg border border-line bg-canvas/50 p-4 text-xs leading-relaxed text-muted">
              {DISCLAIMER_TEXT}
            </div>

            {/* Customer details — captured here since the site has no login */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ModalField
                label="Your name"
                value={customer.name}
                onChange={(v) => setCustomer((c) => ({ ...c, name: v }))}
                placeholder="Jane Smith"
                required
              />
              <ModalField
                label="Email"
                type="email"
                value={customer.email}
                onChange={(v) => setCustomer((c) => ({ ...c, email: v }))}
                placeholder="jane@clinic.org"
                required
              />
              <div className="sm:col-span-2">
                <ModalField
                  label="Organization"
                  value={customer.company}
                  onChange={(v) => setCustomer((c) => ({ ...c, company: v }))}
                  placeholder="Clinic or company name"
                  required
                />
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#ff7a3d]"
              />
              <span>
                I have read and accept the terms above, and understand this is a
                preliminary, non-binding budgetary estimate.
              </span>
            </label>
            {error && <p className="mt-3 text-sm text-warn">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDisclaimer(false)}
                disabled={submitting}
                className="text-sm text-muted transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={submitQuote}
                disabled={!accepted || !customerReady || submitting}
                className="btn-accent rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? "Generating…" : "Accept & generate quote"}
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

function CartIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function ModalField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium uppercase tracking-wide text-faint">
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
      />
    </label>
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

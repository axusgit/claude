import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DISCLAIMER_TITLE, DISCLAIMER_TEXT } from "@/lib/disclaimer";
import { RemoveLineButton } from "@/app/components/RemoveLineButton";
import { QuoteActions } from "@/app/components/QuoteActions";

export const dynamic = "force-dynamic";

// Budgetary estimates are whole-dollar and prefixed with ~ to read as approximate.
const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const approx = (n: number) => `~${usd0(n)}`;

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

const dateOnly = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d);

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const { id } = await params;
  const adminReview = (await searchParams)?.review === "1";

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { include: { catalogItem: true } } },
  });
  if (!quote) notFound();

  const expired = quote.validUntil.getTime() < Date.now();
  const hasContactUs = quote.lines.some((l) => l.lineTotal == null);
  const isSample = (process.env.SYNNEX_ADAPTER ?? "mock").toLowerCase() !== "real";

  return (
    <div className="mx-auto max-w-4xl">
      {/* Axus letterhead — only visible when printing / saving as PDF.
          An <img> (not a CSS background) so it prints without the browser's
          "Background graphics" option being enabled. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/axus-letterhead.jpg" alt="" aria-hidden className="print-letterhead" />

      {/* Print frame: the empty thead/tfoot rows repeat on every printed page and
          reserve space so content never overlaps the letterhead header/footer.
          On screen the whole thing collapses to normal block flow. */}
      <table className="print-frame">
        <thead className="pf-head">
          <tr>
            <td>
              <div className="pf-space-top" />
            </td>
          </tr>
        </thead>
        <tfoot className="pf-foot">
          <tr>
            <td>
              <div className="pf-space-bottom" />
            </td>
          </tr>
        </tfoot>
        <tbody className="pf-body">
          <tr>
            <td>
      <Link href="/" className="no-print text-sm text-muted transition-colors hover:text-ink">
        ← Back to catalog
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Quote for <span className="grad-text">Guidance</span> Purposes
          </h1>
          <p className="mt-1 font-mono text-xs text-faint">#{quote.quoteNumber ?? quote.id}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-muted">
            Valid until <span className="text-ink">{dateOnly(quote.validUntil)}</span>
          </div>
          {expired ? (
            <span className="mt-1 inline-block rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
              Expired — request a fresh quote
            </span>
          ) : (
            <span className="mt-1 inline-block rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-xs font-medium text-ok">
              {quote.status}
            </span>
          )}
        </div>
      </div>

      {/* Customer information (from the logged-in account) */}
      <div className="print-keep glass mt-6 rounded-xl p-5">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-cyan">
          Customer Information
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          <Field label="Name" value={quote.customerName ?? "—"} />
          <Field label="Email" value={quote.customerEmail ?? "—"} />
          <Field label="Quote #" value={quote.quoteNumber ?? quote.id} mono />
          <Field label="Date" value={dateOnly(quote.createdAt)} />
        </div>
      </div>

      {isSample && (
        <div className="mt-3 rounded-lg border border-line bg-white/[0.02] px-4 py-2 text-xs text-muted">
          Sample pricing — not yet connected to live distributor data.
        </div>
      )}

      {/* Line items */}
      <div className="glass mt-6 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Unit (approx.)</th>
                <th className="px-4 py-3 text-right font-medium">Line total</th>
                {!adminReview && <th className="no-print px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => {
                const contact = l.lineTotal == null || l.unitBallpark == null;
                return (
                  <tr key={l.id} className="border-b border-line/70 align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">
                        {l.usedReplacement
                          ? l.description
                          : l.catalogItem?.internalName ?? l.description}
                      </div>
                      {l.usedReplacement && (
                        <div className="mt-0.5 text-[11px] text-cyan">
                          Suggested alternative selected — replaces {l.originalName}
                        </div>
                      )}
                      {l.synnexSKU &&
                        !/^MOCK-/i.test(l.synnexSKU) &&
                        l.synnexSKU.trim().length >= 4 && (
                          <div className="mt-0.5 font-mono text-[11px] text-cyan/80">
                            SKU {l.synnexSKU}
                          </div>
                        )}
                      {contact && (
                        <div className="mt-0.5 text-[11px] text-warn">
                          Configurable / custom — we&rsquo;ll price this for you
                        </div>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-muted">{l.qty}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">
                      {contact ? (
                        <span className="text-warn">Not available</span>
                      ) : (
                        approx(l.unitBallpark!)
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-semibold text-ink">
                      {contact ? (
                        <span className="text-warn">Not available</span>
                      ) : (
                        approx(l.lineTotal!)
                      )}
                    </td>
                    {!adminReview && (
                      <td className="no-print px-4 py-3 text-right">
                        <RemoveLineButton quoteId={quote.id} lineId={l.id} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-white/[0.03]">
                <td colSpan={3} className="px-4 py-3.5 text-right text-sm font-medium text-muted">
                  Subtotal (approx., priced items)
                </td>
                <td className="tabular px-4 py-3.5 text-right font-display text-lg font-semibold text-accent">
                  {approx(quote.subtotal)}
                </td>
                {!adminReview && <td className="no-print" />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {hasContactUs && (
        <p className="mt-3 text-xs text-muted">
          Some items are shown as{" "}
          <span className="font-medium text-warn">Not available</span> (with a suggested
          alternative on the catalog). They&rsquo;re not included in the subtotal — an
          Axus rep will follow up with pricing.
        </p>
      )}

      {/* Legal disclaimer — printed below the pricing on every quote */}
      <div className="print-keep mt-6 rounded-xl border border-accent/25 bg-accent-soft/40 p-5">
        <h2 className="font-display text-sm font-semibold text-accent">
          {DISCLAIMER_TITLE}
        </h2>
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">
          {DISCLAIMER_TEXT}
        </p>
        {quote.disclaimerAcceptedAt && (
          <p className="mt-3 text-[11px] text-muted">
            Accepted by{" "}
            <span className="text-ink">
              {quote.customerName ?? quote.customerEmail ?? "the customer"}
            </span>{" "}
            on {dateFmt(quote.disclaimerAcceptedAt)}.
          </p>
        )}
      </div>

      <QuoteActions quoteId={quote.id} adminReview={adminReview} />
      <p className="no-print mt-3 text-xs text-faint">
        This quote is saved — bookmark this page to return to it anytime, or download a
        PDF copy above.
      </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-faint">
        {label}
      </span>
      <span className={"text-ink " + (mono ? "font-mono text-xs" : "text-sm")}>
        {value}
      </span>
    </div>
  );
}

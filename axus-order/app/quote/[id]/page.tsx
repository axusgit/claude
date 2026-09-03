import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { include: { catalogItem: true } } },
  });
  if (!quote) notFound();

  const expired = quote.validUntil.getTime() < Date.now();
  const hasContactUs = quote.lines.some((l) => l.lineTotal == null);
  // Sample pricing when not running against the real TD SYNNEX adapter.
  const isSample = (process.env.SYNNEX_ADAPTER ?? "mock").toLowerCase() !== "real";

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/"
        className="text-sm text-muted hover:text-ink transition-colors"
      >
        ← Back to catalog
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ballpark Quote</h1>
          <p className="mt-1 font-mono text-xs text-faint">#{quote.id}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-muted">
            Valid until <span className="text-ink">{dateFmt(quote.validUntil)}</span>
          </div>
          {expired ? (
            <span className="mt-1 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-warn">
              Expired — request a fresh quote
            </span>
          ) : (
            <span className="mt-1 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
              {quote.status}
            </span>
          )}
        </div>
      </div>

      {/* Disclaimer banner */}
      <div className="mt-6 rounded-lg border border-line bg-accent-soft/60 px-4 py-3 text-sm text-warn">
        <strong className="font-semibold">Indicative ballpark, non-binding.</strong>{" "}
        Pricing and availability are estimates valid until the date above and are
        subject to change. Final pricing is confirmed on your formal order.
      </div>

      {isSample && (
        <div className="mt-3 rounded-md border border-line bg-canvas px-4 py-2 text-xs text-muted">
          Sample pricing — not yet connected to live TD SYNNEX data.
        </div>
      )}

      {/* Line items */}
      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Unit (ballpark)</th>
                <th className="px-4 py-3 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => {
                const contact = l.lineTotal == null || l.unitBallpark == null;
                return (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {l.catalogItem?.internalName ?? l.description}
                      </div>
                      {l.synnexSKU && !l.synnexSKU.startsWith("MOCK-") && (
                        <div className="mt-0.5 font-mono text-[11px] text-faint">
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
                    <td className="tabular px-4 py-3 text-right">
                      {contact ? (
                        <span className="text-warn">Contact us</span>
                      ) : (
                        usd(l.unitBallpark!)
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {contact ? (
                        <span className="text-warn">Contact us</span>
                      ) : (
                        usd(l.lineTotal!)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-canvas">
                <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-muted">
                  Subtotal (priced items)
                </td>
                <td className="tabular px-4 py-3 text-right text-base font-semibold">
                  {usd(quote.subtotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {hasContactUs && (
        <p className="mt-3 text-xs text-muted">
          Some items are configurable and shown as{" "}
          <span className="font-medium text-warn">Contact us</span>. They&rsquo;re not
          included in the subtotal — an Axus rep will follow up with pricing.
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Continue shopping
        </Link>
        <a
          href={`mailto:sales@axustechnologies.com?subject=${encodeURIComponent(`Quote ${quote.id}`)}`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Talk to Axus about this quote
        </a>
      </div>
    </div>
  );
}

// app/admin/quotes/page.tsx — full list of created quotes (admin, SSO-gated).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEntitledIdentity } from "@/lib/auth";
import { DeleteQuoteButton } from "./DeleteQuoteButton";
import { ResendEmailButton } from "./ResendEmailButton";

export const dynamic = "force-dynamic";

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const dt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function AdminQuotesPage() {
  const identity = await getEntitledIdentity();
  if (!identity) {
    return (
      <div className="glass mx-auto max-w-lg rounded-xl p-8 text-center">
        <h1 className="font-display text-lg font-semibold">Sign-in required</h1>
        <p className="mt-2 text-sm text-muted">The quotes list is restricted to Axus administrators.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to catalog
        </Link>
      </div>
    );
  }

  const [count, quotes] = await Promise.all([
    prisma.quote.count(),
    prisma.quote.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { lines: true } } },
      take: 1000,
    }),
  ]);

  return (
    <div className="pb-16">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Created <span className="grad-text">Quotes</span>
        </h1>
        <Link href="/admin" className="text-sm text-muted transition-colors hover:text-ink">
          ← Back to dashboard
        </Link>
      </div>
      <p className="mb-5 text-sm text-muted">
        {count} quote{count === 1 ? "" : "s"} generated (most recent first). Click a quote
        number to open it.
      </p>

      <div className="glass overflow-hidden rounded-xl">
        <div className="max-h-[78vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-surface text-left text-[11px] uppercase tracking-wider text-faint [&>th]:bg-surface">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Quote #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 text-right font-medium">Items</th>
                <th className="px-4 py-3 text-right font-medium">Subtotal</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted">
                    No quotes yet.
                  </td>
                </tr>
              )}
              {quotes.map((q) => (
                <tr key={q.id} className="border-b border-line/70 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{dt(q.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/quote/${q.id}?review=1`}
                      className="font-mono text-xs text-cyan hover:underline"
                    >
                      {q.quoteNumber ?? q.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-ink">{q.customerName ?? "—"}</div>
                    <div className="text-[11px] text-faint">{q.customerEmail ?? ""}</div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{q.customerCompany ?? "—"}</td>
                  <td className="tabular px-4 py-2.5 text-right text-muted">{q._count.lines}</td>
                  <td className="tabular px-4 py-2.5 text-right text-ink">{usd0(q.subtotal)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <EmailBadge status={q.emailStatus} at={q.emailedAt} error={q.emailError} />
                      <ResendEmailButton quoteId={q.id} status={q.emailStatus} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-faint">
                    {q.ipAddress ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <DeleteQuoteButton
                      quoteId={q.id}
                      label={q.quoteNumber ?? q.id.slice(0, 8)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EmailBadge({
  status,
  at,
  error,
}: {
  status: string | null;
  at: Date | null;
  error: string | null;
}) {
  if (status === "sent") {
    return (
      <span
        title={at ? `Sent ${dt(at)}` : "Sent"}
        className="inline-block rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok"
      >
        Sent
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        title={error ?? "Send failed"}
        className="inline-block rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn"
      >
        Failed
      </span>
    );
  }
  return <span className="text-[11px] text-faint">Not sent</span>;
}

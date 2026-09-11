// app/admin/page.tsx
// Usage & audit dashboard — recent quotes + page visits for the open (no-login)
// site. Reachable only behind the Authentik SSO wall on /admin (nginx), and
// additionally gated here on app-order membership.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEntitledIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const dt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function AdminDashboard() {
  const identity = await getEntitledIdentity();
  if (!identity) {
    return (
      <div className="glass mx-auto max-w-lg rounded-xl p-8 text-center">
        <h1 className="font-display text-lg font-semibold">Sign-in required</h1>
        <p className="mt-2 text-sm text-muted">
          This dashboard is restricted to Axus administrators.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to catalog
        </Link>
      </div>
    );
  }

  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [quoteCount, quotes7, visitCount, visits7, quotes, visits] = await Promise.all([
    prisma.quote.count(),
    prisma.quote.count({ where: { createdAt: { gte: since7 } } }),
    prisma.visit.count(),
    prisma.visit.count({ where: { createdAt: { gte: since7 } } }),
    prisma.quote.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.visit.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  return (
    <div className="pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Usage &amp; <span className="grad-text">Audit</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Quotes created and site activity — signed in as {identity.email}
          </p>
        </div>
        <Link
          href="/admin/catalog"
          className="rounded-lg border border-line bg-white/[0.02] px-4 py-2 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent"
        >
          Catalog Status →
        </Link>
      </div>

      {/* Summary tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Quotes (total)" value={quoteCount} />
        <Stat label="Quotes (7 days)" value={quotes7} accent />
        <Stat label="Visits (total)" value={visitCount} />
        <Stat label="Visits (7 days)" value={visits7} accent />
      </div>

      {/* Recent quotes */}
      <section className="mt-9">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-[0.15em] text-cyan">
          Recent quotes
        </h2>
        <div className="glass overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Quote #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 text-right font-medium">Subtotal</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      No quotes yet.
                    </td>
                  </tr>
                )}
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-line/70 last:border-0">
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
                    <td className="tabular px-4 py-2.5 text-right text-ink">
                      {usd0(q.subtotal)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-faint">
                      {q.ipAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Recent visits */}
      <section className="mt-9">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-[0.15em] text-cyan">
          Recent visits
        </h2>
        <div className="glass overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Path</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">User agent</th>
                </tr>
              </thead>
              <tbody>
                {visits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted">
                      No visits recorded yet.
                    </td>
                  </tr>
                )}
                {visits.map((v) => (
                  <tr key={v.id} className="border-b border-line/70 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{dt(v.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{v.path}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-faint">{v.ip ?? "—"}</td>
                    <td className="max-w-[22rem] truncate px-4 py-2.5 text-[11px] text-faint">
                      {v.userAgent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div
        className={
          "mt-1 font-display text-3xl font-semibold " + (accent ? "grad-text" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}

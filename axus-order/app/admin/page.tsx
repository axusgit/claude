// app/admin/page.tsx
// Usage & audit dashboard — recent quotes + page visits for the open (no-login)
// site. Reachable only behind the Authentik SSO wall on /admin (nginx), and
// additionally gated here on app-order membership.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEntitledIdentity } from "@/lib/auth";
import { geoForIps, type Geo } from "@/lib/geoip";

export const dynamic = "force-dynamic";

// IPs to hide from the visitor list by default (yours/office). Override with the
// ADMIN_HIDE_IPS env var (comma-separated). Shown when ?all=1.
const HIDE_IPS = new Set(
  (process.env.ADMIN_HIDE_IPS ?? "47.198.206.63")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function isBot(ua: string | null): boolean {
  return !!ua && /bot|crawl|spider|slurp|bingpreview|monitor|curl|wget|headless|python-requests|axios|node-fetch/i.test(ua);
}

function locationOf(g?: Geo): { main: string; sub: string } {
  if (!g) return { main: "—", sub: "" };
  const main = [g.city, g.region].filter(Boolean).join(", ") || g.country || "Unknown";
  const sub = g.country && g.country !== "US" ? g.country : "";
  return { main, sub };
}

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const dt = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

// Lightweight user-agent parse — turns a raw UA into "Browser · OS · Device"
// so the visits table is scannable at a glance (full UA stays on hover).
function parseUA(ua: string | null): { summary: string; device: string } {
  if (!ua) return { summary: "—", device: "" };

  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  else if (/bot|crawl|spider|slurp|bingpreview/i.test(ua)) browser = "Bot";

  let os = "Unknown";
  if (/Windows NT 10/.test(ua)) os = "Windows";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const device = /Mobile|iPhone|iPod|Android.*Mobile/.test(ua)
    ? "Mobile"
    : /iPad|Tablet/.test(ua)
      ? "Tablet"
      : "Desktop";

  const summary = [browser, os].filter((s) => s !== "Unknown").join(" · ") || "Unknown";
  return { summary, device };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const showAll = (await searchParams)?.all === "1";
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
  const [quoteCount, quotes7, visitCount, quotes, visitsRaw] = await Promise.all([
    prisma.quote.count(),
    prisma.quote.count({ where: { createdAt: { gte: since7 } } }),
    prisma.visit.count(),
    prisma.quote.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.visit.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);

  // Collapse the raw hit-log into one row per visitor (IP): where they are,
  // how many times they came, whether they opened a quote, first/last seen.
  type Visit = (typeof visitsRaw)[number];
  const byIp = new Map<string, Visit[]>();
  for (const v of visitsRaw) {
    const ip = v.ip ?? "unknown";
    (byIp.get(ip) ?? byIp.set(ip, []).get(ip)!).push(v);
  }

  let visitors = Array.from(byIp.entries()).map(([ip, vs]) => {
    // vs is newest-first (query order preserved).
    const last = vs[0];
    const first = vs[vs.length - 1];
    const paths = Array.from(new Set(vs.map((v) => v.path)));
    const quoteHit = vs.find((v) => v.path.startsWith("/quote/"));
    const bot = isBot(last.userAgent);
    return {
      ip,
      count: vs.length,
      pageCount: paths.length,
      openedQuote: !!quoteHit,
      quoteId: quoteHit ? quoteHit.path.split("/")[2] ?? null : null,
      firstSeen: first.createdAt,
      lastSeen: last.createdAt,
      userAgent: last.userAgent,
      hidden: HIDE_IPS.has(ip) || bot,
    };
  });

  const hiddenCount = visitors.filter((v) => v.hidden).length;
  const uniqueExternal = visitors.filter((v) => !v.hidden).length;
  if (!showAll) visitors = visitors.filter((v) => !v.hidden);
  visitors.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  visitors = visitors.slice(0, 200);

  const geo = await geoForIps(visitors.map((v) => v.ip));

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
        <Stat label="Unique visitors" value={uniqueExternal} accent />
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

      {/* Recent visitors — one row per IP, geo-located, own/bot traffic hidden */}
      <section className="mt-9">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.15em] text-cyan">
            Recent visitors
          </h2>
          {hiddenCount > 0 && (
            <Link
              href={showAll ? "/admin" : "/admin?all=1"}
              className="text-[11px] text-faint hover:text-accent hover:underline"
            >
              {showAll
                ? "← Hide your own IP & bots"
                : `Showing external visitors · ${hiddenCount} hidden (your IP + bots) — show all →`}
            </Link>
          )}
        </div>
        <div className="glass overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-3 font-medium">Visitor</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">ISP / Org</th>
                  <th className="px-4 py-3 text-right font-medium">Visits</th>
                  <th className="px-4 py-3 font-medium">Quote?</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                  <th className="px-4 py-3 font-medium">Device</th>
                </tr>
              </thead>
              <tbody>
                {visitors.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted">
                      No external visitors recorded yet.
                    </td>
                  </tr>
                )}
                {visitors.map((v) => {
                  const ua = parseUA(v.userAgent);
                  const loc = locationOf(geo.get(v.ip));
                  return (
                    <tr key={v.ip} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] text-ink">{v.ip}</div>
                        {v.hidden && (
                          <div className="text-[10px] text-faint">your IP / bot</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-ink">{loc.main}</div>
                        {loc.sub && <div className="text-[10px] text-faint">{loc.sub}</div>}
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2.5 text-[11px] text-muted">
                        {geo.get(v.ip)?.org ?? "—"}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink">
                        {v.count}
                        <span className="ml-1 text-[10px] text-faint">
                          / {v.pageCount} page{v.pageCount === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px]">
                        {v.openedQuote && v.quoteId ? (
                          <Link
                            href={`/quote/${v.quoteId}?review=1`}
                            className="text-cyan hover:underline"
                          >
                            ✓ opened
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-muted">
                        <div className="text-ink">{dt(v.lastSeen)}</div>
                        <div className="text-[10px] text-faint">first {dt(v.firstSeen)}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-muted">
                        <div className="text-ink">{ua.summary}</div>
                        {ua.device && <div className="text-[10px] text-faint">{ua.device}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Grouped by IP · location from a cached GeoIP lookup · newest first.
        </p>
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

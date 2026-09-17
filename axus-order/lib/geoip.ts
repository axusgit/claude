// lib/geoip.ts
// On-demand IP geolocation for the admin audit view. Results are cached in the
// IpGeo table so each IP is looked up over the network at most once. Uses the
// free ip-api.com batch endpoint (no key; HTTP-only on the free tier). Degrades
// silently to "unknown" if the lookup is unavailable — geo is a nicety, not a
// hard dependency of the page.
import { prisma } from "@/lib/prisma";

export interface Geo {
  city: string | null;
  region: string | null; // short code, e.g. "FL"
  country: string | null; // ISO code, e.g. "US"
  org: string | null; // network owner / ISP
}

// RFC1918 / loopback / link-local — never worth a lookup.
const PRIVATE =
  /^(10\.|127\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

function isPublicIp(ip: string): boolean {
  return !!ip && ip !== "unknown" && !PRIVATE.test(ip);
}

/** Return a map of IP → Geo for the given IPs, filling the cache as needed. */
export async function geoForIps(ips: string[]): Promise<Map<string, Geo>> {
  const out = new Map<string, Geo>();
  const uniq = Array.from(new Set(ips.filter(isPublicIp)));
  if (uniq.length === 0) return out;

  const cached = await prisma.ipGeo.findMany({ where: { ip: { in: uniq } } });
  for (const c of cached) {
    out.set(c.ip, { city: c.city, region: c.region, country: c.country, org: c.org });
  }

  const misses = uniq.filter((ip) => !out.has(ip));
  if (misses.length > 0) {
    try {
      const found = await batchLookup(misses);
      for (const r of found) {
        const geo: Geo = {
          city: r.city || null,
          region: r.region || null,
          country: r.countryCode || null,
          org: r.org || r.isp || null,
        };
        out.set(r.query, geo);
        await prisma.ipGeo.upsert({
          where: { ip: r.query },
          create: { ip: r.query, ...geo },
          update: { ...geo, fetchedAt: new Date() },
        });
      }
    } catch {
      // network/geo unavailable — leave misses unresolved; columns show "—".
    }
  }
  return out;
}

interface IpApiRow {
  status: string;
  query: string;
  city?: string;
  region?: string;
  countryCode?: string;
  isp?: string;
  org?: string;
}

async function batchLookup(ips: string[]): Promise<IpApiRow[]> {
  const results: IpApiRow[] = [];
  const FIELDS = "status,countryCode,region,city,isp,org,query";
  for (let i = 0; i < ips.length; i += 100) {
    const chunk = ips.slice(i, i + 100);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`http://ip-api.com/batch?fields=${FIELDS}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.ok) {
        const data: IpApiRow[] = await res.json();
        for (const d of data) if (d.status === "success") results.push(d);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

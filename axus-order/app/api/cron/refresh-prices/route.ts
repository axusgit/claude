// app/api/cron/refresh-prices/route.ts
// Nightly price refresh trigger (called by the 1 AM ET cron on the box).
// Guarded by CRON_SECRET so only the scheduler can run it.
import { NextRequest, NextResponse } from "next/server";
import { refreshPrices } from "@/lib/refresh-prices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const r = await refreshPrices();
    console.log(`Price refresh: updated ${r.updated} items at ${r.at.toISOString()}`);
    return NextResponse.json({ ok: true, updated: r.updated, at: r.at.toISOString() });
  } catch (err) {
    console.error("Price refresh failed:", err);
    return NextResponse.json({ error: "Price refresh failed." }, { status: 500 });
  }
}

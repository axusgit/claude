// app/api/cron/retry-emails/route.ts
// Auto-retry quote emails that failed to send (e.g. during a transient M365 outage).
// Called every ~10 min by the box cron; guarded by CRON_SECRET. Only retries recent
// failures so a permanently-bad address doesn't get hammered forever.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendQuoteEmail } from "@/lib/send-quote-email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Give up auto-retrying after this many failed attempts or this age — admin can still
// resend manually from the quotes list.
const MAX_ATTEMPTS = 30;
const MAX_AGE_HOURS = 48;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000);
  const stuck = await prisma.quote.findMany({
    where: {
      emailStatus: "failed",
      emailAttempts: { lt: MAX_ATTEMPTS },
      createdAt: { gte: cutoff },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 25,
  });

  let sent = 0;
  const stillFailing: string[] = [];
  for (const q of stuck) {
    const r = await sendQuoteEmail(q.id);
    if (r.ok) sent++;
    else stillFailing.push(q.id);
  }

  if (stuck.length) {
    console.log(`Email retry: ${sent}/${stuck.length} recovered; ${stillFailing.length} still failing.`);
  }
  return NextResponse.json({ ok: true, retried: stuck.length, sent, stillFailing: stillFailing.length });
}

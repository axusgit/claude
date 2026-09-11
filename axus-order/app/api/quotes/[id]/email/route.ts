// app/api/quotes/[id]/email/route.ts
// POST: email the quote (PDF attached, on the Axus letterhead) to Axus sales, with the
// customer CC'd and set as reply-to. Triggered by "Talk to Axus about this quote" on the
// public quote page, and reused by the admin "Resend" button. The build/send/retry and
// delivery-status bookkeeping live in lib/send-quote-email.ts.
import { NextRequest, NextResponse } from "next/server";
import { sendQuoteEmail } from "@/lib/send-quote-email";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await sendQuoteEmail(id);
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: result.error }, { status: result.status });
}

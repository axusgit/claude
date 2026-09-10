// app/api/quotes/[id]/remove-line/route.ts
// Remove a single line from a saved quote and recompute its subtotal.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { lineId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.lineId) return NextResponse.json({ error: "Missing lineId." }, { status: 400 });

  const quote = await prisma.quote.findUnique({ where: { id }, include: { lines: true } });
  if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });

  // The line must belong to this quote (scoped delete).
  const line = quote.lines.find((l) => l.id === body.lineId);
  if (!line) return NextResponse.json({ error: "Line not found." }, { status: 404 });

  try {
    await prisma.quoteLine.delete({ where: { id: line.id } });
    const remaining = quote.lines.filter((l) => l.id !== line.id);
    const subtotal = round2(remaining.reduce((s, l) => s + (l.lineTotal ?? 0), 0));
    await prisma.quote.update({ where: { id }, data: { subtotal } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not remove the item." }, { status: 500 });
  }
}

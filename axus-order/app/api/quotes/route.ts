// app/api/quotes/route.ts  (Next.js App Router)
// POST: build + persist a quote from a cart.  GET ?id=: fetch a saved quote.
// Both responses are client-safe — the partner cost snapshot never leaves the server.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildQuote, type CartLineInput } from "@/lib/synnex/quote-service";
// import { auth } from "@/lib/auth"; // NextAuth — uncomment once wired

export async function POST(req: NextRequest) {
  // const session = await auth();
  // if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { cart?: CartLineInput[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const cart = (body.cart ?? []).filter((l) => l?.catalogItemId && l.qty > 0);
  if (!cart.length) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });

  const catalog = await prisma.catalogItem.findMany({
    where: { id: { in: cart.map((l) => l.catalogItemId) }, active: true },
  });
  if (!catalog.length) return NextResponse.json({ error: "No valid catalog items" }, { status: 400 });

  const build = await buildQuote(
    cart,
    catalog.map((c) => ({
      id: c.id, internalName: c.internalName, synnexSKU: c.synnexSKU, mfgPN: c.mfgPN,
      marginType: c.marginType as "PERCENT" | "FIXED", marginValue: c.marginValue,
    }))
  );

  const quote = await prisma.quote.create({
    data: {
      status: "DRAFT",
      subtotal: build.subtotal,
      currency: build.currency,
      validUntil: build.validUntil,
      lines: {
        create: build.lines.map((l) => ({
          catalogItemId: l.catalogItemId,
          description: l.description ?? l.internalName,
          synnexSKU: l.synnexSKU,
          qty: l.qty,
          unitBallpark: l.unitBallpark,
          lineTotal: l.lineTotal,
          unitCostSnapshot: build._serverCostByCatalogItemId[l.catalogItemId], // server-only col
          status: l.status,
        })),
      },
    },
  });

  return NextResponse.json({
    id: quote.id,
    status: quote.status,
    currency: build.currency,
    subtotal: build.subtotal,
    validUntil: build.validUntil.toISOString(),
    hasUnavailable: build.hasUnavailable,
    lines: build.lines, // already client-safe (no cost)
    disclaimer: "Indicative ballpark, non-binding. Pricing and availability valid for 24 hours.",
  });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const quote = await prisma.quote.findUnique({ where: { id }, include: { lines: true } });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: quote.id,
    status: quote.status,
    currency: quote.currency,
    subtotal: quote.subtotal,
    validUntil: quote.validUntil.toISOString(),
    expired: quote.validUntil.getTime() < Date.now(),
    lines: quote.lines.map((l) => ({ // strip unitCostSnapshot explicitly
      description: l.description,
      synnexSKU: l.synnexSKU,
      qty: l.qty,
      unitBallpark: l.unitBallpark,
      lineTotal: l.lineTotal,
      status: l.status,
    })),
  });
}

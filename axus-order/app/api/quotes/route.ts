// app/api/quotes/route.ts  (Next.js App Router)
// POST: build + persist a quote from a cart (requires disclaimer acceptance; captures
// the logged-in customer identity). GET ?id=: fetch a saved quote.
// Both responses are client-safe — the partner cost snapshot never leaves the server.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildQuote, type CartLineInput } from "@/lib/synnex/quote-service";
import { getIdentity } from "@/lib/auth";

// --- Human-friendly quote number: <3-letter business><MMDDYYYY><NNN> ---
function businessCode(email?: string | null, name?: string | null): string {
  const domain = email && email.includes("@") ? email.split("@")[1]?.split(".")[0] : "";
  const src = (domain || name || "").replace(/[^a-zA-Z]/g, "");
  return (src.slice(0, 3) || "QTE").toUpperCase();
}

function mmddyyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}${dd}${d.getFullYear()}`;
}

// Next 3-digit sequence for this business+date prefix (starts at 001).
async function nextQuoteNumber(prefix: string): Promise<string> {
  const last = await prisma.quote.findFirst({
    where: { quoteNumber: { startsWith: prefix } },
    orderBy: { quoteNumber: "desc" },
    select: { quoteNumber: true },
  });
  const lastSeq = last?.quoteNumber
    ? parseInt(last.quoteNumber.slice(prefix.length), 10) || 0
    : 0;
  return prefix + String(lastSeq + 1).padStart(3, "0");
}

export async function POST(req: NextRequest) {
  let body: { cart?: CartLineInput[]; accepted?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Disclaimer must be explicitly accepted before a quote is generated.
  if (!body.accepted) {
    return NextResponse.json(
      { error: "You must read and accept the disclaimer to generate a quote." },
      { status: 400 }
    );
  }

  const cart = (body.cart ?? []).filter((l) => l?.catalogItemId && l.qty > 0);
  if (!cart.length)
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  try {
    const identity = await getIdentity();

    const catalog = await prisma.catalogItem.findMany({
      where: { id: { in: cart.map((l) => l.catalogItemId) }, active: true },
    });
    if (!catalog.length)
      return NextResponse.json({ error: "No valid catalog items." }, { status: 400 });

    const build = await buildQuote(
      cart,
      catalog.map((c) => ({
        id: c.id,
        internalName: c.internalName,
        synnexSKU: c.synnexSKU,
        mfgPN: c.mfgPN,
        marginType: c.marginType as "PERCENT" | "FIXED",
        marginValue: c.marginValue,
      }))
    );

    const prefix = businessCode(identity?.email, identity?.name) + mmddyyyy(new Date());
    const lineData = build.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      description: l.description ?? l.internalName,
      synnexSKU: l.synnexSKU,
      qty: l.qty,
      unitBallpark: l.unitBallpark,
      lineTotal: l.lineTotal,
      unitCostSnapshot: build._serverCostByCatalogItemId[l.catalogItemId], // server-only col
      status: l.status,
    }));

    // Create with a retry in case two quotes race for the same sequence number.
    let quote;
    for (let attempt = 0; ; attempt++) {
      const quoteNumber = await nextQuoteNumber(prefix);
      try {
        quote = await prisma.quote.create({
          data: {
            quoteNumber,
            status: "DRAFT",
            subtotal: build.subtotal,
            currency: build.currency,
            validUntil: build.validUntil,
            customerName: identity?.name ?? null,
            customerEmail: identity?.email ?? null,
            disclaimerAcceptedAt: new Date(),
            lines: { create: lineData },
          },
        });
        break;
      } catch (e) {
        // P2002 = unique constraint (quoteNumber) — retry with the next sequence.
        if (attempt >= 4 || (e as { code?: string })?.code !== "P2002") throw e;
      }
    }

    return NextResponse.json({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      currency: build.currency,
      subtotal: build.subtotal,
      validUntil: build.validUntil.toISOString(),
      hasUnavailable: build.hasUnavailable,
      lines: build.lines, // already client-safe (no cost)
      disclaimer: "Indicative ballpark, non-binding. Pricing and availability valid for 30 days.",
    });
  } catch (err) {
    // Never leak an empty/500 body to the client — always return JSON.
    console.error("Quote build failed:", err);
    return NextResponse.json(
      {
        error:
          "We couldn't build your quote right now (a pricing source may be temporarily unavailable). Please try again in a moment.",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const quote = await prisma.quote.findUnique({ where: { id }, include: { lines: true } });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    currency: quote.currency,
    subtotal: quote.subtotal,
    validUntil: quote.validUntil.toISOString(),
    expired: quote.validUntil.getTime() < Date.now(),
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    lines: quote.lines.map((l) => ({
      // strip unitCostSnapshot explicitly
      description: l.description,
      synnexSKU: l.synnexSKU,
      qty: l.qty,
      unitBallpark: l.unitBallpark,
      lineTotal: l.lineTotal,
      status: l.status,
    })),
  });
}

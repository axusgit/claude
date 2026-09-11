// app/admin/quotes/delete/route.ts
// Delete a quote (and its lines, via cascade). Under /admin so it's behind the
// Authentik SSO wall; also verifies the entitled identity.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEntitledIdentity } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const identity = await getEntitledIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  let body: { quoteId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.quoteId) return NextResponse.json({ error: "Missing quoteId." }, { status: 400 });

  try {
    await prisma.quote.delete({ where: { id: body.quoteId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete the quote." }, { status: 500 });
  }
}

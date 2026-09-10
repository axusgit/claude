// app/admin/catalog/save/route.ts
// Set a catalog item's TD SYNNEX SKU. Lives under /admin so it's behind the same
// Authentik SSO wall (nginx); also verifies the entitled identity as defense-in-depth.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEntitledIdentity } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const identity = await getEntitledIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let body: {
    id?: string;
    synnexSKU?: string;
    replacementSku?: string;
    replacementName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing item id." }, { status: 400 });

  // Update only the fields that were sent.
  const data: Record<string, string | null> = {};
  if (body.synnexSKU !== undefined) data.synnexSKU = body.synnexSKU.trim() || null;
  if (body.replacementSku !== undefined) data.replacementSku = body.replacementSku.trim() || null;
  if (body.replacementName !== undefined)
    data.replacementName = body.replacementName.trim() || null;
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    await prisma.catalogItem.update({ where: { id: body.id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update item." }, { status: 500 });
  }
}

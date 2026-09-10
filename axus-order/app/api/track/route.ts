// app/api/track/route.ts
// Lightweight, credential-free page-visit logging for the open site. The client
// beacons the current path here on load; the server stamps IP + user-agent.
// Best-effort only — failures are swallowed so tracking never affects the user.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  try {
    let path = "/";
    try {
      const body = (await req.json()) as { path?: string };
      if (typeof body.path === "string" && body.path) path = body.path.slice(0, 512);
    } catch {
      /* empty/invalid body — default path */
    }
    // Don't log the admin dashboard's own views.
    if (!path.startsWith("/admin")) {
      await prisma.visit.create({
        data: {
          path,
          ip: clientIp(req),
          userAgent: (req.headers.get("user-agent") ?? "").slice(0, 512) || null,
          referer: (req.headers.get("referer") ?? "").slice(0, 512) || null,
        },
      });
    }
  } catch {
    /* never fail a beacon */
  }
  return NextResponse.json({ ok: true });
}

// proxy.ts  (Next.js 16 "proxy" convention — formerly middleware.ts)
// Defense-in-depth auth gate. In production the Authentik forward-auth outpost in
// front of this app is the real gate (it redirects unauthenticated users to the
// IdP and injects the X-authentik-* headers). This middleware simply refuses any
// request that did NOT arrive through that outpost, or from a user lacking this
// app's entitlement group. In local dev (AUTH_MODE=local) it lets everything
// through so the app runs standalone.
//
// Kept intentionally in lock-step with lib/auth.ts.
import { NextRequest, NextResponse } from "next/server";

const AUTH_MODE = process.env.AUTH_MODE ?? "local";
const APP_GROUP = process.env.APP_GROUP ?? "app-order";

function splitGroups(raw: string | null): string[] {
  if (!raw) return [];
  const sep = raw.includes("|") ? "|" : ",";
  return raw.split(sep).map((g) => g.trim()).filter(Boolean);
}

export function proxy(req: NextRequest) {
  // Health endpoint is unauthenticated (server-to-server Hub health checks).
  if (req.nextUrl.pathname === "/api/health") return NextResponse.next();

  if (AUTH_MODE === "local") return NextResponse.next();

  const email = req.headers.get("x-authentik-email");
  if (!email) {
    return NextResponse.json(
      { error: "No authenticated identity (request did not pass the Authentik outpost)" },
      { status: 401 }
    );
  }
  const groups = splitGroups(req.headers.get("x-authentik-groups"));
  if (!groups.includes(APP_GROUP)) {
    return NextResponse.json(
      { error: `Access to '${APP_GROUP}' is required` },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

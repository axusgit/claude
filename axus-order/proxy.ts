// proxy.ts  (Next.js 16 "proxy" convention — formerly middleware.ts)
// Defense-in-depth auth gate. In production the Authentik forward-auth outpost in
// front of this app is the real gate (it redirects unauthenticated users to the
// IdP and injects the X-authentik-* headers). This proxy then enforces:
//   1. a valid identity + the app-order entitlement group, and
//   2. an EMAIL ALLOWLIST — only these users may see any TD SYNNEX data (pricing,
//      SKUs, availability, quotes). Other app-order members are let in but routed
//      to /no-access until their email is added to TDSYNNEX_ALLOWED_EMAILS.
// In local dev (AUTH_MODE=local) everything is allowed so the app runs standalone.
import { NextRequest, NextResponse } from "next/server";

const AUTH_MODE = process.env.AUTH_MODE ?? "local";
const APP_GROUP = process.env.APP_GROUP ?? "app-order";
const ALLOWED_EMAILS = (
  process.env.TDSYNNEX_ALLOWED_EMAILS ?? "admin@axustechnologies.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function splitGroups(raw: string | null): string[] {
  if (!raw) return [];
  const sep = raw.includes("|") ? "|" : ",";
  return raw.split(sep).map((g) => g.trim()).filter(Boolean);
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Health endpoint is unauthenticated (server-to-server Hub health checks).
  if (pathname === "/api/health") return NextResponse.next();

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

  // --- TD SYNNEX data allowlist ---
  const isAllowed = ALLOWED_EMAILS.includes(email.toLowerCase());

  if (pathname === "/no-access") {
    // Allowed users never need this page; bounce them to the catalog.
    return isAllowed ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (!isAllowed) {
    // No TD SYNNEX data for non-allowlisted users.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Pricing access is restricted to authorized administrators." },
        { status: 403 }
      );
    }
    return NextResponse.rewrite(new URL("/no-access", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

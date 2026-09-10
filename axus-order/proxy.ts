// proxy.ts  (Next.js 16 "proxy" convention — formerly middleware.ts)
// OPEN ACCESS: the Readiness Order site is public — no login. There is no identity
// gate and no pricing allowlist; the catalog and live pricing are shown to everyone.
// (The /admin/catalog page still self-restricts to admins inside the app, so it is
// simply not reachable without an authenticated admin identity.)
import { NextResponse } from "next/server";

export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};

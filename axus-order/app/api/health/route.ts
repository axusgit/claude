// app/api/health/route.ts — unauthenticated liveness probe for the Hub command
// center (see APP_CATALOG "health" URL). Never returns anything sensitive.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "axus-order",
    adapter: (process.env.SYNNEX_ADAPTER ?? "mock").toLowerCase(),
    time: new Date().toISOString(),
  });
}

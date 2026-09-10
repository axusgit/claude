"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Beacons the current path to /api/track on each navigation so the open (no-login)
// site still has a usage log. Fire-and-forget; never blocks or surfaces errors.
export function VisitLogger() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    try {
      const body = JSON.stringify({ path: pathname });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);
  return null;
}

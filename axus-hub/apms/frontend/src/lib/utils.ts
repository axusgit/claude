import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ISO timestamp → compact relative/absolute Eastern time for the audit log & "updated".
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Copy to clipboard and auto-clear after `clearMs` (so secrets don't linger).
export async function copyWithAutoClear(text: string, clearMs = 20_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.setTimeout(() => {
    navigator.clipboard.writeText("").catch(() => {
      /* ignore — clipboard may be unavailable when the tab is backgrounded */
    });
  }, clearMs);
}

// A principal label for display: 'group:app-apms' → 'app-apms (group)'.
export function principalLabel(principal: string): string {
  const [kind, ...rest] = principal.split(":");
  const name = rest.join(":");
  return kind === "user" ? name : `${name}`;
}

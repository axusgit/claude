// lib/auth.ts
// Central identity for Axus platform apps — TypeScript port of libs/auth/axus_auth
// (the shared Python module). SAME contract, so this app fits the platform:
//
//   In production, the Authentik forward-auth outpost (in front of every app via
//   Traefik/Nginx auth_request) authenticates the request and injects trusted
//   identity headers. This app reads them instead of running its own login.
//
//   In local dev (AUTH_MODE=local) an identity is synthesized from env vars so the
//   app runs standalone without the IdP.
//
// Keep this in sync with libs/auth/axus_auth/identity.py.
import { headers } from "next/headers";

// Headers injected by Authentik's proxy / forward-auth outpost.
const H_EMAIL = "x-authentik-email";
const H_USERNAME = "x-authentik-username";
const H_NAME = "x-authentik-name";
const H_GROUPS = "x-authentik-groups"; // separated by "|" or ","

// "central" trusts the forward-auth headers; "local" uses the dev fallback.
// Defaults to "local" so the app runs standalone; production sets AUTH_MODE=central.
export const AUTH_MODE = process.env.AUTH_MODE ?? "local";

// This app's Authentik entitlement group (tile visibility + forward-auth gate).
export const APP_GROUP = process.env.APP_GROUP ?? "app-order";

// Role groups in descending privilege; the highest one the user holds wins.
const ROLE_ORDER = ["admin", "finance", "engineer", "technician", "client"] as const;
export type Role = (typeof ROLE_ORDER)[number];

export interface Identity {
  email: string;
  username: string;
  name: string;
  groups: string[];
}

export function hasGroup(id: Identity, group: string): boolean {
  return id.groups.includes(group);
}

export function roleOf(id: Identity): Role | "technician" {
  for (const r of ROLE_ORDER) if (id.groups.includes(`role-${r}`)) return r;
  return "technician";
}

// Only these emails may see TD SYNNEX data (pricing, SKUs, availability, quotes).
// Other app-order members added later are let into the platform but NOT into the
// pricing data until their email is added here. Comma-separated; defaults to admin.
export const PRICING_ALLOWED_EMAILS = (
  process.env.TDSYNNEX_ALLOWED_EMAILS ?? "admin@axustechnologies.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function canSeePricing(id: Identity | null): boolean {
  if (!id) return false;
  return PRICING_ALLOWED_EMAILS.includes(id.email.toLowerCase());
}

function splitGroups(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const sep = raw.includes("|") ? "|" : ",";
  return raw.split(sep).map((g) => g.trim()).filter(Boolean);
}

/** The authenticated platform identity for this request, or null if unauthenticated. */
export async function getIdentity(): Promise<Identity | null> {
  if (AUTH_MODE === "local") {
    return {
      email: process.env.DEV_USER_EMAIL ?? "dev@axustechnologies.com",
      username: process.env.DEV_USER_NAME ?? "dev",
      name: process.env.DEV_USER_NAME ?? "Dev User",
      groups: splitGroups(
        process.env.DEV_USER_GROUPS ?? "role-admin|app-hub|app-order"
      ),
    };
  }
  const h = await headers();
  const email = h.get(H_EMAIL);
  if (!email) {
    // Forward-auth guarantees this header; its absence means the request did not
    // pass through the Authentik outpost.
    return null;
  }
  return {
    email,
    username: h.get(H_USERNAME) ?? email,
    name: h.get(H_NAME) ?? email,
    groups: splitGroups(h.get(H_GROUPS)),
  };
}

/** Like getIdentity, but also requires membership of this app's entitlement group. */
export async function getEntitledIdentity(): Promise<Identity | null> {
  const id = await getIdentity();
  if (!id) return null;
  if (!hasGroup(id, APP_GROUP)) return null;
  return id;
}

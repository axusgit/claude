// Identity comes from the Authentik forward-auth proxy headers (same contract as
// libs/auth). Both contractors and admins sign in via Hub SSO.
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export interface Identity {
  email: string;
  username: string;
  name: string;
  groups: string[];
}

const H_EMAIL = "x-authentik-email";
const H_USERNAME = "x-authentik-username";
const H_NAME = "x-authentik-name";
const H_GROUPS = "x-authentik-groups"; // separated by "|" or ","

function splitGroups(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[|,]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function getIdentity(req: FastifyRequest): Identity | null {
  const email = header(req, H_EMAIL);
  if (!email) {
    // Dev fallback (only when DEV_USER_EMAIL is set and no proxy header present).
    if (config.dev.email) {
      return {
        email: config.dev.email,
        username: config.dev.email,
        name: config.dev.name,
        groups: splitGroups(config.dev.groups),
      };
    }
    return null;
  }
  return {
    email,
    username: header(req, H_USERNAME) ?? email,
    name: header(req, H_NAME) ?? email,
    groups: splitGroups(header(req, H_GROUPS)),
  };
}

export type AtrsRole = "admin" | "contractor";

// Platform admins (authentik Admins) and anyone in atrs-role-admin approve time.
// Everyone else with app access is a contractor (logs their own time).
export function atrsRole(id: Identity): AtrsRole {
  if (id.groups.includes("atrs-role-admin") || id.groups.includes("authentik Admins")) {
    return "admin";
  }
  return "contractor";
}

export function hasAtrsAccess(id: Identity): boolean {
  return (
    id.groups.includes("app-atrs") ||
    id.groups.includes("atrs-role-admin") ||
    id.groups.includes("atrs-role-contractor") ||
    id.groups.includes("authentik Admins")
  );
}

// Guard for any authenticated ATRS user; returns the identity or 403s.
export function requireUser(req: FastifyRequest, reply: FastifyReply): Identity | null {
  const id = getIdentity(req);
  if (!id || !hasAtrsAccess(id)) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  return id;
}

// Guard for admin-only routes (approvals, cross-contractor views).
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): Identity | null {
  const id = requireUser(req, reply);
  if (!id) return null;
  if (atrsRole(id) !== "admin") {
    reply.code(403).send({ error: "Admins only" });
    return null;
  }
  return id;
}

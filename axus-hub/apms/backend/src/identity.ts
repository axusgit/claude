// Identity comes from the Authentik forward-auth proxy headers (same contract as
// libs/auth and the other Axus apps). APMS access is gated UPSTREAM by the
// Authentik policy binding (only app-apms / apms-role-* may pass the outpost);
// this module re-checks app access and derives the in-app role.
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

export type ApmsRole = "admin" | "user";

// A vault admin (apms-role-admin) manages folders, access, import and holds the
// recovery key. Deliberately NO "authentik Admins" fallback here: like AATS, this
// sensitive app is gated strictly by its own groups so a broad platform-admin role
// does not silently grant vault access. Everyone else with app access is a "user".
export function apmsRole(id: Identity): ApmsRole {
  return id.groups.includes("apms-role-admin") ? "admin" : "user";
}

export function hasApmsAccess(id: Identity): boolean {
  return (
    id.groups.includes("app-apms") ||
    id.groups.includes("apms-role-admin") ||
    id.groups.includes("apms-role-user")
  );
}

// Guard for any authenticated APMS user; returns the identity or 403s.
export function requireUser(req: FastifyRequest, reply: FastifyReply): Identity | null {
  const id = getIdentity(req);
  if (!id || !hasApmsAccess(id)) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  return id;
}

// Guard for vault-admin routes (folders, access, import, rekey, audit).
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): Identity | null {
  const id = requireUser(req, reply);
  if (!id) return null;
  if (apmsRole(id) !== "admin") {
    reply.code(403).send({ error: "Vault admins only" });
    return null;
  }
  return id;
}

// The set of access principals this identity matches: their own user id plus each
// of their Authentik groups. Used by access.ts to resolve folder visibility.
export function principalsFor(id: Identity): string[] {
  return [`user:${id.email.toLowerCase()}`, ...id.groups.map((g) => `group:${g}`)];
}

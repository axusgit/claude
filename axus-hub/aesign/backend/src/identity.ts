// Staff identity comes from the Authentik forward-auth proxy headers (same
// contract as libs/auth). External signers never hit these routes — they use
// tokenized links instead.
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
    // Dev fallback (only when DEV_USER_EMAIL is set and no proxy header present)
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

// Highest eSign role the user holds, or null. Order = descending privilege.
const ROLES = ["admin", "manager", "member"] as const;
export type EsignRole = (typeof ROLES)[number];

export function esignRole(id: Identity): EsignRole | null {
  for (const r of ROLES) if (id.groups.includes(`aesign-role-${r}`)) return r;
  return null;
}

export function hasEsignAccess(id: Identity): boolean {
  return id.groups.includes("app-aesign") || esignRole(id) !== null;
}

// Guard for staff-only routes: returns the identity, or 403s and returns null.
export function requireStaff(req: FastifyRequest, reply: FastifyReply): Identity | null {
  const id = getIdentity(req);
  if (!id || !hasEsignAccess(id)) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }
  return id;
}

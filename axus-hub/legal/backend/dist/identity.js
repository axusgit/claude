import { config } from "./config.js";
const H_EMAIL = "x-authentik-email";
const H_USERNAME = "x-authentik-username";
const H_NAME = "x-authentik-name";
const H_GROUPS = "x-authentik-groups"; // separated by "|" or ","
function splitGroups(raw) {
    if (!raw)
        return [];
    return raw
        .split(/[|,]/)
        .map((g) => g.trim())
        .filter(Boolean);
}
function header(req, name) {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
}
export function getIdentity(req) {
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
// Highest legal role the user holds, or null. Order = descending privilege.
const ROLES = ["admin", "manager", "member"];
export function legalRole(id) {
    for (const r of ROLES)
        if (id.groups.includes(`legal-role-${r}`))
            return r;
    return null;
}
export function hasLegalAccess(id) {
    return id.groups.includes("app-legal") || legalRole(id) !== null;
}
// Guard for staff-only routes: returns the identity, or 403s and returns null.
export function requireStaff(req, reply) {
    const id = getIdentity(req);
    if (!id || !hasLegalAccess(id)) {
        reply.code(403).send({ error: "Forbidden" });
        return null;
    }
    return id;
}
//# sourceMappingURL=identity.js.map
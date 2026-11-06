import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { apmsRole, requireUser } from "../identity.js";

// Who am I + my role + whether the vault has been created yet, so the SPA can
// render the lock screen (unlock) vs. the first-run "create vault" flow.
export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const initialized =
      (await pool.query("select 1 from vault where id = true")).rowCount === 1;
    return {
      email: id.email.toLowerCase(),
      name: id.name,
      role: apmsRole(id),
      groups: id.groups,
      vaultInitialized: initialized,
    };
  });
}

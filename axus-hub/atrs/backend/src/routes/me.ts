import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { atrsRole, requireUser } from "../identity.js";

// Upsert the signed-in person into the worker table (first login auto-registers
// them) and return who they are + their role, so the SPA can render the right
// view. Safe to call on every page load.
export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const email = id.email.toLowerCase();
    await pool.query(
      `insert into worker (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name`,
      [email, id.name],
    );
    return { email, name: id.name, role: atrsRole(id) };
  });
}

import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../identity.js";

// Admin view of everyone who has logged in / logged time, with lifetime totals.
export async function workerRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const rows = (
      await pool.query(
        `select w.email, w.name, w.active, w.created_at,
                coalesce(sum(e.hours) filter (where e.status = 'approved'),0)::float8 as approved_hours,
                coalesce(sum(e.hours) filter (where e.status = 'submitted'),0)::float8 as submitted_hours,
                count(e.id) filter (where e.status = 'submitted')::int as pending_n
         from worker w left join time_entry e on e.worker_email = w.email
         group by w.email, w.name, w.active, w.created_at
         order by w.active desc, w.name`,
      )
    ).rows;
    return { workers: rows };
  });

  // Activate / deactivate a worker (history is always preserved).
  app.patch("/:email", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const email = decodeURIComponent((req.params as { email: string }).email).toLowerCase();
    const active = !!((req.body ?? {}) as { active?: boolean }).active;
    const r = await pool.query(`update worker set active = $1 where email = $2`, [active, email]);
    if (!r.rowCount) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}

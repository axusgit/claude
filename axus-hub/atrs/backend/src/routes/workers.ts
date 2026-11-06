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
        `select w.email, w.name, w.active, w.rate::float8 as rate, w.created_at,
                coalesce(sum(e.hours) filter (where e.status = 'approved'),0)::float8 as approved_hours,
                coalesce(sum(e.hours) filter (where e.status = 'submitted'),0)::float8 as submitted_hours,
                count(e.id) filter (where e.status = 'submitted')::int as pending_n
         from worker w left join time_entry e on e.worker_email = w.email
         group by w.email, w.name, w.active, w.rate, w.created_at
         order by w.active desc, w.name`,
      )
    ).rows;
    return { workers: rows };
  });

  // Update a worker: activate/deactivate and/or set their pay rate ($/hour).
  // History is always preserved. Both fields are optional; send what changed.
  app.patch("/:email", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const email = decodeURIComponent((req.params as { email: string }).email).toLowerCase();
    const body = (req.body ?? {}) as { active?: boolean; rate?: number };

    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body.active === "boolean") {
      params.push(body.active);
      sets.push(`active = $${params.length}`);
    }
    if (body.rate !== undefined) {
      const rate = Number(body.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
        return reply.code(400).send({ error: "Rate must be a number between 0 and 100000." });
      }
      params.push(Math.round(rate * 100) / 100);
      sets.push(`rate = $${params.length}`);
    }
    if (!sets.length) return reply.code(400).send({ error: "Nothing to update." });
    params.push(email);
    const r = await pool.query(`update worker set ${sets.join(", ")} where email = $${params.length}`, params);
    if (!r.rowCount) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}

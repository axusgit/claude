import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireStaff } from "../identity.js";

export async function companyRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const { rows } = await pool.query(`select id, name from company order by name`);
    return { companies: rows };
  });

  app.post("/", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as { name?: string };
    if (!b.name?.trim()) return reply.code(400).send({ error: "Company name is required." });
    const { rows } = await pool.query(
      `insert into company (name, created_by) values ($1, $2)
       on conflict (lower(name)) do update set name = excluded.name
       returning id, name`,
      [b.name.trim(), id.email],
    );
    return { company: rows[0] };
  });

  app.delete("/:id", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    await pool.query(`delete from company where id = $1`, [(req.params as { id: string }).id]);
    return { ok: true };
  });
}

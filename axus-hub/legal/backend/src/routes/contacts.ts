import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireStaff } from "../identity.js";

export async function contactRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const { rows } = await pool.query(
      `select id, name, email, company from contact order by name`,
    );
    return { contacts: rows };
  });

  // Add (or update-by-email) a contact.
  app.post("/", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as { name?: string; email?: string; company?: string };
    if (!b.name?.trim() || !b.email?.trim()) {
      return reply.code(400).send({ error: "Name and email are required." });
    }
    const { rows } = await pool.query(
      `insert into contact (name, email, company, created_by) values ($1, $2, $3, $4)
       on conflict (lower(email)) do update
         set name = excluded.name, company = excluded.company
       returning id, name, email, company`,
      [b.name.trim(), b.email.trim(), b.company?.trim() || null, id.email],
    );
    return { contact: rows[0] };
  });

  // Edit a contact's name / email / company.
  app.patch("/:id", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const cid = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as { name?: string; email?: string; company?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.name !== undefined) {
      sets.push(`name = $${i++}`);
      vals.push(b.name.trim());
    }
    if (b.email !== undefined) {
      sets.push(`email = $${i++}`);
      vals.push(b.email.trim());
    }
    if (b.company !== undefined) {
      sets.push(`company = $${i++}`);
      vals.push(b.company?.trim() || null);
    }
    if (!sets.length) return reply.code(400).send({ error: "Nothing to update." });
    vals.push(cid);
    try {
      const { rows } = await pool.query(
        `update contact set ${sets.join(", ")} where id = $${i} returning id, name, email, company`,
        vals,
      );
      if (!rows.length) return reply.code(404).send({ error: "Not found" });
      return { contact: rows[0] };
    } catch {
      return reply.code(409).send({ error: "A contact with that email already exists." });
    }
  });

  app.delete("/:id", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    await pool.query(`delete from contact where id = $1`, [(req.params as { id: string }).id]);
    return { ok: true };
  });

  // Bulk import (e.g. from a QuickBooks customer export). The frontend parses the
  // CSV and sends {contacts:[{name,email,company}]}; we upsert each by email.
  app.post("/import", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as { contacts?: { name?: string; email?: string; company?: string }[] };
    const list = b.contacts ?? [];
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    let imported = 0;
    let skipped = 0;
    for (const c of list) {
      const email = (c.email ?? "").trim();
      const name = (c.name ?? "").trim();
      if (!email || !emailRe.test(email)) {
        skipped++;
        continue;
      }
      await pool.query(
        `insert into contact (name, email, company, created_by) values ($1, $2, $3, $4)
         on conflict (lower(email)) do update
           set name = excluded.name,
               company = coalesce(excluded.company, contact.company)`,
        [name || email, email, (c.company ?? "").trim() || null, id.email],
      );
      imported++;
    }
    return { imported, skipped };
  });
}

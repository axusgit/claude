import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin, requireUser } from "../identity.js";
import { resolveAccess } from "../access.js";
import { logAudit } from "../auditlog.js";

function str(v: unknown, max = 4_000_000): string | null {
  return typeof v === "string" && v.length > 0 && v.length < max ? v : null;
}

export async function itemRoutes(app: FastifyInstance) {
  // Every item the caller may read, as ciphertext. The client decrypts in-browser
  // and does all searching locally (titles/usernames are encrypted server-side).
  app.get("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const acc = await resolveAccess(id);
    const ids = [...acc.readable];
    if (ids.length === 0) return { items: [] };
    const rows = (
      await pool.query<{
        id: string;
        folder_id: string;
        data_enc: string;
        updated_at: string;
        updated_by: string;
      }>(
        `select id, folder_id, data_enc, updated_at, updated_by
         from item where folder_id = any($1) order by updated_at desc`,
        [ids],
      )
    ).rows;
    return { items: rows };
  });

  app.post("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const folder_id = str(b.folder_id, 100);
    const data_enc = str(b.data_enc);
    if (!folder_id || !data_enc) return reply.code(400).send({ error: "Missing folder/data" });
    const acc = await resolveAccess(id);
    if (!acc.writable.has(folder_id)) return reply.code(403).send({ error: "No write access" });
    const r = await pool.query<{ id: string }>(
      `insert into item (folder_id, data_enc, updated_by) values ($1, $2, $3) returning id`,
      [folder_id, data_enc, id.email.toLowerCase()],
    );
    await logAudit(id.email.toLowerCase(), "item_create", r.rows[0].id, folder_id);
    return { id: r.rows[0].id };
  });

  app.patch("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const iid = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data_enc = str(b.data_enc);
    const target_folder = b.folder_id === undefined ? undefined : str(b.folder_id, 100);
    if (!data_enc && target_folder === undefined) return reply.code(400).send({ error: "Nothing to update" });
    const acc = await resolveAccess(id);
    const cur = (
      await pool.query<{ folder_id: string }>("select folder_id from item where id = $1", [iid])
    ).rows[0];
    if (!cur) return reply.code(404).send({ error: "Not found" });
    if (!acc.writable.has(cur.folder_id)) return reply.code(403).send({ error: "No write access" });
    if (target_folder !== undefined && target_folder && !acc.writable.has(target_folder)) {
      return reply.code(403).send({ error: "No write access to the target folder" });
    }
    const sets: string[] = ["updated_at = now()", "updated_by = $1"];
    const vals: unknown[] = [id.email.toLowerCase()];
    if (data_enc) {
      sets.push(`data_enc = $${vals.length + 1}`);
      vals.push(data_enc);
    }
    if (target_folder) {
      sets.push(`folder_id = $${vals.length + 1}`);
      vals.push(target_folder);
    }
    vals.push(iid);
    await pool.query(`update item set ${sets.join(", ")} where id = $${vals.length}`, vals);
    await logAudit(id.email.toLowerCase(), "item_update", iid);
    return { ok: true };
  });

  app.delete("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const iid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    const cur = (
      await pool.query<{ folder_id: string }>("select folder_id from item where id = $1", [iid])
    ).rows[0];
    if (!cur) return reply.code(404).send({ error: "Not found" });
    if (!acc.writable.has(cur.folder_id)) return reply.code(403).send({ error: "No write access" });
    await pool.query("delete from item where id = $1", [iid]);
    await logAudit(id.email.toLowerCase(), "item_delete", iid);
    return { ok: true };
  });

  // Bulk create for KeePass import (admin only). The browser has already parsed the
  // CSV and encrypted every item under the right folder key — this only stores the
  // ciphertext. Any folders needed were created first via POST /api/folders.
  app.post("/import", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const raw = (req.body as { items?: unknown })?.items;
    const items = Array.isArray(raw) ? raw : [];
    const clean = items
      .map((i) => i as Record<string, unknown>)
      .map((i) => ({ folder_id: str(i.folder_id, 100), data_enc: str(i.data_enc) }))
      .filter((i): i is { folder_id: string; data_enc: string } => !!i.folder_id && !!i.data_enc);
    if (clean.length === 0) return reply.code(400).send({ error: "No items" });
    const acc = await resolveAccess(id);
    for (const i of clean) {
      if (!acc.writable.has(i.folder_id)) return reply.code(400).send({ error: "Unknown/!writable folder in batch" });
    }
    const client = await pool.connect();
    let n = 0;
    try {
      await client.query("begin");
      for (const i of clean) {
        await client.query(
          "insert into item (folder_id, data_enc, updated_by) values ($1, $2, $3)",
          [i.folder_id, i.data_enc, id.email.toLowerCase()],
        );
        n++;
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    await logAudit(id.email.toLowerCase(), "import", null, `${n} item(s)`);
    return { ok: true, imported: n };
  });
}

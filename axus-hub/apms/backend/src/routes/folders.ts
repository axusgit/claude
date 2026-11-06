import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { apmsRole, requireAdmin, requireUser } from "../identity.js";
import { resolveAccess } from "../access.js";
import { logAudit } from "../auditlog.js";

function str(v: unknown, max = 100_000): string | null {
  return typeof v === "string" && v.length > 0 && v.length < max ? v : null;
}

export async function folderRoutes(app: FastifyInstance) {
  // List the folders this caller may read (admins: all). Each row carries the
  // encrypted name + the VK-wrapped folder key the client needs to decrypt items.
  app.get("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const acc = await resolveAccess(id);
    const rows = (
      await pool.query<{
        id: string;
        parent_id: string | null;
        name_enc: string;
        wrapped_fk: string;
        sort: number;
      }>("select id, parent_id, name_enc, wrapped_fk, sort from folder order by sort, created_at")
    ).rows.filter((f) => acc.readable.has(f.id));
    return {
      folders: rows.map((f) => ({ ...f, can_write: acc.isAdmin || acc.writable.has(f.id) })),
      isAdmin: acc.isAdmin,
    };
  });

  // Create a folder. Admins may create anywhere; a non-admin may create only under
  // a folder they can write to (the new folder inherits the parent's access).
  app.post("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name_enc = str(b.name_enc);
    const wrapped_fk = str(b.wrapped_fk);
    const parent_id = b.parent_id == null ? null : str(b.parent_id, 100);
    const sort = Number.isFinite(b.sort) ? Number(b.sort) : 0;
    if (!name_enc || !wrapped_fk) return reply.code(400).send({ error: "Missing name/key" });

    const admin = apmsRole(id) === "admin";
    if (!admin) {
      if (!parent_id) return reply.code(403).send({ error: "Only admins can create top-level folders" });
      const acc = await resolveAccess(id);
      if (!acc.writable.has(parent_id)) return reply.code(403).send({ error: "No write access here" });
    }
    if (parent_id) {
      const ok = (await pool.query("select 1 from folder where id = $1", [parent_id])).rowCount === 1;
      if (!ok) return reply.code(400).send({ error: "Parent not found" });
    }
    const r = await pool.query<{ id: string }>(
      `insert into folder (parent_id, name_enc, wrapped_fk, sort, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [parent_id, name_enc, wrapped_fk, sort, id.email.toLowerCase()],
    );
    await logAudit(id.email.toLowerCase(), "folder_create", r.rows[0].id);
    return { id: r.rows[0].id };
  });

  // Rename / reorder (writable) or move (admin only — moving changes who inherits).
  app.patch("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (!acc.writable.has(fid)) return reply.code(403).send({ error: "No write access" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const name_enc = b.name_enc === undefined ? undefined : str(b.name_enc);
    if (name_enc !== undefined) {
      if (!name_enc) return reply.code(400).send({ error: "Bad name" });
      sets.push(`name_enc = $${sets.length + 1}`);
      vals.push(name_enc);
    }
    if (b.sort !== undefined) {
      sets.push(`sort = $${sets.length + 1}`);
      vals.push(Number(b.sort) || 0);
    }
    if (b.parent_id !== undefined) {
      if (!acc.isAdmin) return reply.code(403).send({ error: "Only admins can move folders" });
      const pid = b.parent_id == null ? null : str(b.parent_id, 100);
      if (pid === fid) return reply.code(400).send({ error: "A folder cannot be its own parent" });
      sets.push(`parent_id = $${sets.length + 1}`);
      vals.push(pid);
    }
    if (sets.length === 0) return reply.code(400).send({ error: "Nothing to update" });
    vals.push(fid);
    const r = await pool.query(`update folder set ${sets.join(", ")} where id = $${vals.length}`, vals);
    if (r.rowCount === 0) return reply.code(404).send({ error: "Not found" });
    await logAudit(id.email.toLowerCase(), "folder_update", fid);
    return { ok: true };
  });

  // Delete a folder and everything under it (cascades to subfolders + items).
  app.delete("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (!acc.writable.has(fid)) return reply.code(403).send({ error: "No write access" });
    const r = await pool.query("delete from folder where id = $1", [fid]);
    if (r.rowCount === 0) return reply.code(404).send({ error: "Not found" });
    await logAudit(id.email.toLowerCase(), "folder_delete", fid);
    return { ok: true };
  });

  // Access grants on a folder (admin only). principal = 'group:<name>' | 'user:<email>'.
  app.get("/:id/access", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const rows = (
      await pool.query<{ principal: string; can_write: boolean }>(
        "select principal, can_write from folder_access where folder_id = $1 order by principal",
        [fid],
      )
    ).rows;
    return { grants: rows };
  });

  app.put("/:id/access", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    if ((await pool.query("select 1 from folder where id = $1", [fid])).rowCount === 0) {
      return reply.code(404).send({ error: "Folder not found" });
    }
    const raw = (req.body as { grants?: unknown })?.grants;
    const grants = Array.isArray(raw) ? raw : [];
    const clean = grants
      .map((g) => g as Record<string, unknown>)
      .map((g) => ({ principal: str(g.principal, 300), can_write: g.can_write !== false }))
      .filter((g): g is { principal: string; can_write: boolean } => !!g.principal && /^(group|user):/.test(g.principal));
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from folder_access where folder_id = $1", [fid]);
      for (const g of clean) {
        await client.query(
          "insert into folder_access (folder_id, principal, can_write) values ($1, $2, $3)",
          [fid, g.principal, g.can_write],
        );
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    await logAudit(id.email.toLowerCase(), "folder_access_set", fid, `${clean.length} principal(s)`);
    return { ok: true };
  });
}

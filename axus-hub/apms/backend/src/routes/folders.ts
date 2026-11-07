import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { apmsRole, requireAdmin, requireUser } from "../identity.js";
import { resolveAccess } from "../access.js";
import { logAudit } from "../auditlog.js";

function str(v: unknown, max = 100_000): string | null {
  return typeof v === "string" && v.length > 0 && v.length < max ? v : null;
}

// Pull + validate the client-produced seal material for a confidential folder.
function readSeal(b: Record<string, unknown>): {
  kdf: string;
  kdf_salt: string;
  wrapped_ck: string;
  verifier: string;
  recovery_pubkey: string;
  recovery_wrapped_ck: string;
} | null {
  const seal = (b.seal ?? {}) as Record<string, unknown>;
  const kdf = str(seal.kdf);
  const kdf_salt = str(seal.kdf_salt);
  const wrapped_ck = str(seal.wrapped_ck);
  const verifier = str(seal.verifier);
  const recovery_pubkey = str(seal.recovery_pubkey);
  const recovery_wrapped_ck = str(seal.recovery_wrapped_ck);
  if (!kdf || !kdf_salt || !wrapped_ck || !verifier || !recovery_pubkey || !recovery_wrapped_ck) return null;
  return { kdf, kdf_salt, wrapped_ck, verifier, recovery_pubkey, recovery_wrapped_ck };
}

export async function folderRoutes(app: FastifyInstance) {
  // List the folders this caller may read (admins: all non-restricted, plus any
  // confidential folder they are explicitly granted). Each row carries the
  // encrypted name + the wrapped folder key the client needs to decrypt items.
  // `restricted`/`sealed` tell the UI to require the confidential passphrase.
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
        restricted: boolean;
        sealed: boolean;
      }>(
        `select f.id, f.parent_id, f.name_enc, f.wrapped_fk, f.sort, f.restricted,
                (s.folder_id is not null) as sealed
         from folder f left join folder_seal s on s.folder_id = f.id
         order by f.sort, f.created_at`,
      )
    ).rows.filter((f) => acc.readable.has(f.id));
    return {
      folders: rows.map((f) => ({ ...f, can_write: acc.writable.has(f.id) })),
      isAdmin: acc.isAdmin,
    };
  });

  // Create a normal folder. Admins may create anywhere EXCEPT inside a confidential
  // zone they don't own (a blind write is still a write); a non-admin may create
  // only under a folder they can write to (the new folder inherits the parent's access).
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
    const acc = await resolveAccess(id);
    if (!admin) {
      if (!parent_id) return reply.code(403).send({ error: "Only admins can create top-level folders" });
      if (!acc.writable.has(parent_id)) return reply.code(403).send({ error: "No write access here" });
    } else if (parent_id && acc.restrictedZone.has(parent_id) && !acc.writable.has(parent_id)) {
      // Admin, but the parent is a confidential folder they don't own.
      return reply.code(403).send({ error: "No access to this confidential folder" });
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

  // Create a CONFIDENTIAL (restricted + sealed) top-level folder in one atomic step:
  // the folder row (restricted), its seal key material, and the owner grants. The
  // folder key was wrapped under a separate confidential key (CK) in the browser,
  // so only someone with the confidential passphrase can decrypt its contents.
  // Admin only. Owners must be explicit — they are the ONLY principals who will
  // see this folder (the creating admin included, via their own grant).
  app.post("/sealed", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name_enc = str(b.name_enc);
    const wrapped_fk = str(b.wrapped_fk);
    const seal = readSeal(b);
    if (!name_enc || !wrapped_fk) return reply.code(400).send({ error: "Missing name/key" });
    if (!seal) return reply.code(400).send({ error: "Missing or incomplete seal material" });
    const owners = (Array.isArray(b.owners) ? b.owners : [])
      .map((o) => str(o, 300))
      .filter((o): o is string => !!o && o.includes("@"))
      .map((o) => `user:${o.toLowerCase()}`);
    if (owners.length === 0) return reply.code(400).send({ error: "At least one owner is required" });

    const client = await pool.connect();
    try {
      await client.query("begin");
      const r = await client.query<{ id: string }>(
        `insert into folder (parent_id, name_enc, wrapped_fk, sort, created_by, restricted)
         values (null, $1, $2, 0, $3, true) returning id`,
        [name_enc, wrapped_fk, id.email.toLowerCase()],
      );
      const fid = r.rows[0].id;
      await client.query(
        `insert into folder_seal
           (folder_id, kdf, kdf_salt, wrapped_ck, verifier, recovery_pubkey, recovery_wrapped_ck, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [fid, seal.kdf, seal.kdf_salt, seal.wrapped_ck, seal.verifier, seal.recovery_pubkey, seal.recovery_wrapped_ck, id.email.toLowerCase()],
      );
      for (const principal of owners) {
        await client.query(
          "insert into folder_access (folder_id, principal, can_write) values ($1, $2, true) on conflict do nothing",
          [fid, principal],
        );
      }
      await client.query("commit");
      await logAudit(id.email.toLowerCase(), "folder_seal_create", fid, `${owners.length} owner(s)`);
      return { id: fid };
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
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
      // Don't let a confidential folder be moved out of its zone, and don't let a
      // folder be moved into a confidential zone the mover doesn't own.
      if (acc.restrictedZone.has(fid)) return reply.code(403).send({ error: "A confidential folder cannot be moved" });
      if (pid && acc.restrictedZone.has(pid) && !acc.writable.has(pid)) {
        return reply.code(403).send({ error: "No access to that confidential folder" });
      }
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

  // Delete a folder and everything under it (cascades to subfolders + items + seal).
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

  // Access grants on a folder. For a NON-restricted folder this is an admin tool;
  // for a confidential folder it is restricted to that folder's own owners, so a
  // vault admin who isn't an owner can neither read its grant list nor add
  // themselves to it. principal = 'group:<name>' | 'user:<email>'.
  app.get("/:id/access", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (acc.restrictedZone.has(fid)) {
      if (!acc.writable.has(fid)) return reply.code(403).send({ error: "Confidential folder owners only" });
    } else if (!acc.isAdmin) {
      return reply.code(403).send({ error: "Vault admins only" });
    }
    const rows = (
      await pool.query<{ principal: string; can_write: boolean }>(
        "select principal, can_write from folder_access where folder_id = $1 order by principal",
        [fid],
      )
    ).rows;
    return { grants: rows };
  });

  app.put("/:id/access", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (acc.restrictedZone.has(fid)) {
      if (!acc.writable.has(fid)) return reply.code(403).send({ error: "Confidential folder owners only" });
    } else if (!acc.isAdmin) {
      return reply.code(403).send({ error: "Vault admins only" });
    }
    if ((await pool.query("select 1 from folder where id = $1", [fid])).rowCount === 0) {
      return reply.code(404).send({ error: "Folder not found" });
    }
    const raw = (req.body as { grants?: unknown })?.grants;
    const grants = Array.isArray(raw) ? raw : [];
    const clean = grants
      .map((g) => g as Record<string, unknown>)
      .map((g) => ({ principal: str(g.principal, 300), can_write: g.can_write !== false }))
      .filter((g): g is { principal: string; can_write: boolean } => !!g.principal && /^(group|user):/.test(g.principal));
    // A confidential folder must keep at least one owner, or its contents become
    // orphaned (nobody can ever see the row again — not even an admin).
    if (acc.restrictedZone.has(fid) && clean.length === 0) {
      return reply.code(400).send({ error: "A confidential folder must keep at least one owner" });
    }
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

  // Seal material for a confidential folder, needed in the browser to derive CK
  // from the confidential passphrase. Owners only — the one gate that keeps a
  // non-owner from ever obtaining even the wrapped key material.
  app.get("/:id/seal", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (!acc.readable.has(fid)) return reply.code(403).send({ error: "Forbidden" });
    const r = await pool.query<{
      kdf: string;
      kdf_salt: string;
      wrapped_ck: string;
      verifier: string;
    }>("select kdf, kdf_salt, wrapped_ck, verifier from folder_seal where folder_id = $1", [fid]);
    if (r.rowCount === 0) return reply.code(404).send({ error: "Not a sealed folder" });
    await logAudit(id.email.toLowerCase(), "folder_seal_unlock", fid);
    return r.rows[0];
  });

  // Change a confidential folder's passphrase: the browser re-wraps the SAME CK
  // under a new confidential-passphrase key. Owners only. No data is re-encrypted.
  app.post("/:id/seal/rekey", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (!acc.writable.has(fid)) return reply.code(403).send({ error: "Confidential folder owners only" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kdf = str(b.kdf);
    const kdf_salt = str(b.kdf_salt);
    const wrapped_ck = str(b.wrapped_ck);
    if (!kdf || !kdf_salt || !wrapped_ck) return reply.code(400).send({ error: "Missing key material" });
    const r = await pool.query(
      `update folder_seal set kdf = $1, kdf_salt = $2, wrapped_ck = $3, rekeyed_at = now() where folder_id = $4`,
      [kdf, kdf_salt, wrapped_ck, fid],
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: "Not a sealed folder" });
    await logAudit(id.email.toLowerCase(), "folder_seal_rekey", fid, String(b.reason ?? "passphrase change"));
    return { ok: true };
  });

  // Break-glass material for a confidential folder: the blob needed to run recovery
  // in the browser with that folder's offline recovery private key. Owners only.
  app.get("/:id/seal/recovery", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const fid = (req.params as { id: string }).id;
    const acc = await resolveAccess(id);
    if (!acc.writable.has(fid)) return reply.code(403).send({ error: "Confidential folder owners only" });
    const r = await pool.query<{ recovery_wrapped_ck: string; recovery_pubkey: string }>(
      "select recovery_wrapped_ck, recovery_pubkey from folder_seal where folder_id = $1",
      [fid],
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: "Not a sealed folder" });
    await logAudit(id.email.toLowerCase(), "folder_seal_recovery_material_read", fid);
    return r.rows[0];
  });
}

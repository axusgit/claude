import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin, requireUser } from "../identity.js";
import { logAudit } from "../auditlog.js";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length < 100_000 ? v : null;
}

// All crypto happens in the browser. These endpoints only store/return opaque
// key-material blobs. The server never sees the passphrase, the vault key, or any
// plaintext secret.
export async function vaultRoutes(app: FastifyInstance) {
  // Material the client needs to UNLOCK: derive PK from (kdf, salt) + passphrase,
  // then AES-unwrap wrapped_vk to recover VK (verifier confirms the passphrase).
  app.get("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const r = await pool.query<{
      kdf: string;
      kdf_salt: string;
      wrapped_vk: string;
      verifier: string;
    }>("select kdf, kdf_salt, wrapped_vk, verifier from vault where id = true");
    if (r.rowCount === 0) return reply.code(404).send({ error: "Vault not initialized" });
    return r.rows[0];
  });

  // First-run: create the vault. Admin only, and only when none exists yet.
  app.post("/init", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    if ((await pool.query("select 1 from vault where id = true")).rowCount === 1) {
      return reply.code(409).send({ error: "Vault already exists" });
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kdf = str(b.kdf);
    const kdf_salt = str(b.kdf_salt);
    const wrapped_vk = str(b.wrapped_vk);
    const verifier = str(b.verifier);
    const recovery_pubkey = str(b.recovery_pubkey);
    const recovery_wrapped_vk = str(b.recovery_wrapped_vk);
    if (!kdf || !kdf_salt || !wrapped_vk || !verifier || !recovery_pubkey || !recovery_wrapped_vk) {
      return reply.code(400).send({ error: "Missing key material" });
    }
    await pool.query(
      `insert into vault (id, kdf, kdf_salt, wrapped_vk, verifier, recovery_pubkey, recovery_wrapped_vk, created_by)
       values (true, $1, $2, $3, $4, $5, $6, $7)`,
      [kdf, kdf_salt, wrapped_vk, verifier, recovery_pubkey, recovery_wrapped_vk, id.email.toLowerCase()],
    );
    await logAudit(id.email.toLowerCase(), "vault_init");
    return { ok: true };
  });

  // Change the passphrase (or complete a recovery): the client re-wraps the SAME
  // VK under a new passphrase-derived key, so no secrets need re-encrypting.
  app.post("/rekey", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kdf = str(b.kdf);
    const kdf_salt = str(b.kdf_salt);
    const wrapped_vk = str(b.wrapped_vk);
    if (!kdf || !kdf_salt || !wrapped_vk) {
      return reply.code(400).send({ error: "Missing key material" });
    }
    const r = await pool.query(
      `update vault set kdf = $1, kdf_salt = $2, wrapped_vk = $3, rekeyed_at = now()
       where id = true`,
      [kdf, kdf_salt, wrapped_vk],
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: "Vault not initialized" });
    await logAudit(id.email.toLowerCase(), "vault_rekey", null, String(b.reason ?? "passphrase change"));
    return { ok: true };
  });

  // Admin-only: the blob needed to run recovery in the browser with the offline
  // recovery private key (RSA-unwrap VK), after which the admin sets a new passphrase.
  app.get("/recovery", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const r = await pool.query<{ recovery_wrapped_vk: string; recovery_pubkey: string }>(
      "select recovery_wrapped_vk, recovery_pubkey from vault where id = true",
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: "Vault not initialized" });
    await logAudit(id.email.toLowerCase(), "vault_recovery_material_read");
    return r.rows[0];
  });
}

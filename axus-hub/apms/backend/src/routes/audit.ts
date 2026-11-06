import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin, requireUser } from "../identity.js";
import { logAudit } from "../auditlog.js";

// Client-reported events worth logging for a password vault. Server-side mutations
// are already logged where they happen; these are browser-only actions.
const CLIENT_ACTIONS = new Set(["unlock", "unlock_failed", "reveal", "copy", "export_recovery_key"]);

export async function auditRoutes(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof b.action === "string" ? b.action : "";
    if (!CLIENT_ACTIONS.has(action)) return reply.code(400).send({ error: "Unknown action" });
    const target = typeof b.target === "string" ? b.target.slice(0, 200) : null;
    await logAudit(id.email.toLowerCase(), action, target);
    return { ok: true };
  });

  // Recent access log — admins only.
  app.get("/", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const qs = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(qs.limit) || 200, 1), 1000);
    const rows = (
      await pool.query<{ ts: string; actor: string; action: string; target: string | null; detail: string | null }>(
        "select ts, actor, action, target, detail from audit order by ts desc limit $1",
        [limit],
      )
    ).rows;
    return { events: rows };
  });
}

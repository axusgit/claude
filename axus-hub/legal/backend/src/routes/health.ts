import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    let db = "down";
    try {
      await pool.query("select 1");
      db = "up";
    } catch {
      /* reported as down */
    }
    return { ok: true, service: "axus-legal", db };
  });
}

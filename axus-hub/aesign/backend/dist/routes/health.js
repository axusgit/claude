import { pool } from "../db.js";
export async function healthRoutes(app) {
    app.get("/api/health", async () => {
        let db = "down";
        try {
            await pool.query("select 1");
            db = "up";
        }
        catch {
            /* reported as down */
        }
        return { ok: true, service: "axus-aesign", db };
    });
}
//# sourceMappingURL=health.js.map
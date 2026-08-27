import { pool } from "../db.js";
import { requireStaff } from "../identity.js";
// Fire-and-forget: record a system movement. Never blocks or breaks a request.
// envelopeId links the entry to a document so its name can be kept in sync.
export function logActivity(actor, action, detail, envelopeId) {
    pool
        .query(`insert into activity (actor, action, detail, envelope_id) values ($1, $2, $3, $4)`, [
        actor,
        action,
        detail ?? null,
        envelopeId ?? null,
    ])
        .catch(() => { });
}
// Keep the log consistent when a document is renamed (e.g. a file upload replaces
// the placeholder title): re-point its creation entry to the current name.
export function renameActivity(envelopeId, newTitle) {
    pool
        .query(`update activity set detail = $1
       where envelope_id = $2 and action in ('Created document', 'Created quote')`, [newTitle, envelopeId])
        .catch(() => { });
}
export async function activityRoutes(app) {
    app.get("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const q = req.query;
        const limit = Math.min(Number(q.limit) || 300, 1000);
        const search = (q.q ?? "").trim();
        const rows = search
            ? await pool.query(`select id, at, actor, action, detail from activity
           where actor ilike $1 or action ilike $1 or detail ilike $1
           order by at desc limit $2`, [`%${search}%`, limit])
            : await pool.query(`select id, at, actor, action, detail from activity order by at desc limit $1`, [
                limit,
            ]);
        return { activity: rows.rows };
    });
}
//# sourceMappingURL=activity.js.map
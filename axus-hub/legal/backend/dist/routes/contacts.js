import { pool } from "../db.js";
import { requireStaff } from "../identity.js";
export async function contactRoutes(app) {
    app.get("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const { rows } = await pool.query(`select id, name, email, company from contact order by name`);
        return { contacts: rows };
    });
    // Add (or update-by-email) a contact.
    app.post("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const b = (req.body ?? {});
        if (!b.name?.trim() || !b.email?.trim()) {
            return reply.code(400).send({ error: "Name and email are required." });
        }
        const { rows } = await pool.query(`insert into contact (name, email, company, created_by) values ($1, $2, $3, $4)
       on conflict (lower(email)) do update
         set name = excluded.name, company = excluded.company
       returning id, name, email, company`, [b.name.trim(), b.email.trim(), b.company?.trim() || null, id.email]);
        return { contact: rows[0] };
    });
    app.delete("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        await pool.query(`delete from contact where id = $1`, [req.params.id]);
        return { ok: true };
    });
}
//# sourceMappingURL=contacts.js.map
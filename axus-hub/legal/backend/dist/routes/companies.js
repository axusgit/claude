import { pool } from "../db.js";
import { requireStaff } from "../identity.js";
export async function companyRoutes(app) {
    app.get("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const { rows } = await pool.query(`select id, name from company order by name`);
        return { companies: rows };
    });
    app.post("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const b = (req.body ?? {});
        if (!b.name?.trim())
            return reply.code(400).send({ error: "Company name is required." });
        const { rows } = await pool.query(`insert into company (name, created_by) values ($1, $2)
       on conflict (lower(name)) do update set name = excluded.name
       returning id, name`, [b.name.trim(), id.email]);
        return { company: rows[0] };
    });
    // Rename a company (and keep any documents pointing at it in sync).
    app.patch("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const cid = req.params.id;
        const b = (req.body ?? {});
        if (!b.name?.trim())
            return reply.code(400).send({ error: "Company name is required." });
        const cur = await pool.query(`select name from company where id = $1`, [cid]);
        if (!cur.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const oldName = cur.rows[0].name;
        const newName = b.name.trim();
        try {
            await pool.query(`update company set name = $1 where id = $2`, [newName, cid]);
        }
        catch {
            return reply.code(409).send({ error: "A company with that name already exists." });
        }
        await pool.query(`update envelope set company = $1 where company = $2`, [newName, oldName]);
        return { company: { id: cid, name: newName } };
    });
    app.delete("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        await pool.query(`delete from company where id = $1`, [req.params.id]);
        return { ok: true };
    });
}
//# sourceMappingURL=companies.js.map
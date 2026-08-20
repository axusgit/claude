import { pool } from "../db.js";
import { requireStaff } from "../identity.js";
export async function companyRoutes(app) {
    app.get("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const { rows } = await pool.query(`select id, name, address, phone from company order by name`);
        return { companies: rows };
    });
    app.post("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const b = (req.body ?? {});
        if (!b.name?.trim())
            return reply.code(400).send({ error: "Company name is required." });
        const { rows } = await pool.query(`insert into company (name, address, phone, created_by) values ($1, $2, $3, $4)
       on conflict (lower(name)) do update
         set name = excluded.name,
             address = coalesce(excluded.address, company.address),
             phone = coalesce(excluded.phone, company.phone)
       returning id, name, address, phone`, [b.name.trim(), b.address?.trim() || null, b.phone?.trim() || null, id.email]);
        return { company: rows[0] };
    });
    // Edit a company's name / address / phone. Renaming keeps documents in sync.
    app.patch("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const cid = req.params.id;
        const b = (req.body ?? {});
        const cur = await pool.query(`select name from company where id = $1`, [cid]);
        if (!cur.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const oldName = cur.rows[0].name;
        if (b.name?.trim()) {
            const newName = b.name.trim();
            try {
                await pool.query(`update company set name = $1 where id = $2`, [newName, cid]);
            }
            catch {
                return reply.code(409).send({ error: "A company with that name already exists." });
            }
            await pool.query(`update envelope set company = $1 where company = $2`, [newName, oldName]);
        }
        if (b.address !== undefined) {
            await pool.query(`update company set address = $1 where id = $2`, [b.address?.trim() || null, cid]);
        }
        if (b.phone !== undefined) {
            await pool.query(`update company set phone = $1 where id = $2`, [b.phone?.trim() || null, cid]);
        }
        const { rows } = await pool.query(`select id, name, address, phone from company where id = $1`, [cid]);
        return { company: rows[0] };
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
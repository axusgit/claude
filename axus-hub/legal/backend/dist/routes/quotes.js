import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { config } from "../config.js";
import { requireStaff } from "../identity.js";
import { generateQuotePdf } from "../quotepdf.js";
// Today's date in Eastern Time as MMDDYYYY (the quote-number prefix).
function etDatePrefix() {
    const p = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
    }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value ?? "";
    return `${get("month")}${get("day")}${get("year")}`;
}
export async function quoteRoutes(app) {
    // Create a Quote — generates the branded PDF and a Quote envelope.
    app.post("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const body = (req.body ?? {});
        const q = body.quote;
        if (!q || !q.customer?.company?.trim()) {
            return reply.code(400).send({ error: "A customer company is required." });
        }
        // Auto quote number: MMDDYYYY.### (### = next in sequence for today, ET).
        const prefix = etDatePrefix();
        const cnt = await pool.query(`select count(*)::int n from envelope where doc_type = 'Quote' and quote_data->>'quote_number' like $1`, [`${prefix}.%`]);
        q.quote_number = `${prefix}.${String(cnt.rows[0].n + 1).padStart(3, "0")}`;
        const title = `${q.customer.company.trim()} — Quote ${q.quote_number}`.slice(0, 200);
        const env = await pool.query(`insert into envelope (title, created_by, doc_type, company, quote_data)
       values ($1, $2, 'Quote', $3, $4) returning id`, [title, id.email, q.customer.company.trim(), JSON.stringify(q)]);
        const envId = env.rows[0].id;
        const bytes = await generateQuotePdf(q);
        const fname = `${envId}-quote.pdf`;
        await writeFile(join(config.storageDir, fname), Buffer.from(bytes));
        await pool.query(`update envelope set source_file = $1, pdf_file = $1 where id = $2`, [fname, envId]);
        await pool.query(`insert into event (envelope_id, actor, type, detail) values ($1, $2, 'created', $3)`, [envId, id.email, title]);
        const updated = await pool.query(`select * from envelope where id = $1`, [envId]);
        return reply.code(201).send({ envelope: updated.rows[0] });
    });
    // Regenerate a draft Quote's PDF from edited data.
    app.put("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const body = (req.body ?? {});
        const q = body.quote;
        if (!q?.customer?.company?.trim())
            return reply.code(400).send({ error: "A customer company is required." });
        const cur = await pool.query(`select status from envelope where id = $1`, [envId]);
        if (!cur.rowCount)
            return reply.code(404).send({ error: "Not found" });
        if (cur.rows[0].status !== "draft") {
            return reply.code(409).send({ error: "Only draft quotes can be edited." });
        }
        const bytes = await generateQuotePdf(q);
        const fname = `${envId}-quote.pdf`;
        await writeFile(join(config.storageDir, fname), Buffer.from(bytes));
        await pool.query(`update envelope set quote_data = $1, company = $2, source_file = $3, pdf_file = $3,
              title = coalesce($4, title) where id = $5`, [JSON.stringify(q), q.customer.company.trim(), fname, body.title?.trim() || null, envId]);
        const updated = await pool.query(`select * from envelope where id = $1`, [envId]);
        return { envelope: updated.rows[0] };
    });
}
//# sourceMappingURL=quotes.js.map
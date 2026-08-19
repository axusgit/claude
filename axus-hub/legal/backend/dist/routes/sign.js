import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sealPdf } from "../seal.js";
import { sendCompleted, sendSigningInvite } from "../mail.js";
async function finalizeEnvelope(envId) {
    const env = await pool.query(`select id, title, pdf_file from envelope where id = $1`, [envId]);
    const e = env.rows[0];
    if (!e?.pdf_file)
        return;
    const fields = await pool.query(`select type, page, x, y, w, h, value from field where envelope_id = $1`, [envId]);
    const recs = await pool.query(`select name, email, sign_token, ip,
            to_char(signed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"') as signed_at
     from recipient where envelope_id = $1 order by sign_order`, [envId]);
    const { bytes, sha256 } = await sealPdf(join(config.storageDir, e.pdf_file), fields.rows, recs.rows, { title: e.title, envelopeId: e.id });
    const sealedName = `${envId}-sealed.pdf`;
    await writeFile(join(config.storageDir, sealedName), bytes);
    await pool.query(`update envelope set status = 'completed', completed_at = now(), sealed_file = $1, sha256 = $2 where id = $3`, [sealedName, sha256, envId]);
    await pool.query(`insert into event (envelope_id, actor, type, detail) values ($1, 'system', 'completed', $2)`, [envId, `Sealed. SHA-256 ${sha256}`]);
    const safeName = e.title.replace(/[^a-z0-9\-_ ]/gi, "_").slice(0, 80) || "document";
    const attachment = { filename: `${safeName}.pdf`, content: Buffer.from(bytes) };
    for (const r of recs.rows) {
        await sendCompleted({ to: r.email, recipientName: r.name, title: e.title, attachment });
    }
}
export async function signRoutes(app) {
    // Signer's view of the document + their fields.
    app.get("/:token", async (req, reply) => {
        const token = req.params.token;
        const rec = await pool.query(`select * from recipient where sign_token = $1`, [token]);
        if (!rec.rowCount)
            return reply.code(404).send({ error: "This signing link is invalid or has expired." });
        const r = rec.rows[0];
        const env = await pool.query(`select id, title, status from envelope where id = $1`, [r.envelope_id]);
        const fields = await pool.query(`select id, type, page, x, y, w, h, value, required from field where recipient_id = $1 order by page`, [r.id]);
        return {
            envelope: env.rows[0],
            recipient: { name: r.name, email: r.email, status: r.status },
            fields: fields.rows,
            alreadySigned: r.status === "signed",
        };
    });
    // Stream the PDF (sealed copy once completed, otherwise the working PDF).
    app.get("/:token/document", async (req, reply) => {
        const token = req.params.token;
        const rec = await pool.query(`select e.pdf_file, e.sealed_file, e.status
       from recipient r join envelope e on e.id = r.envelope_id where r.sign_token = $1`, [token]);
        if (!rec.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const row = rec.rows[0];
        const fileName = row.status === "completed" && row.sealed_file ? row.sealed_file : row.pdf_file;
        if (!fileName)
            return reply.code(404).send({ error: "No document" });
        const full = join(config.storageDir, fileName);
        if (!existsSync(full))
            return reply.code(404).send({ error: "File missing" });
        reply.header("Content-Type", "application/pdf");
        return reply.send(createReadStream(full));
    });
    // Complete signing: record consent + field values + attribution, seal if last.
    app.post("/:token/complete", async (req, reply) => {
        const token = req.params.token;
        const body = (req.body ?? {});
        if (!body.consent) {
            return reply.code(400).send({ error: "You must consent to sign electronically." });
        }
        const rec = await pool.query(`select * from recipient where sign_token = $1`, [token]);
        if (!rec.rowCount)
            return reply.code(404).send({ error: "Invalid link" });
        const r = rec.rows[0];
        if (r.status === "signed")
            return reply.code(409).send({ error: "You have already signed." });
        const envId = r.envelope_id;
        const ip = req.ip;
        const ua = req.headers["user-agent"] ?? "";
        const valueMap = new Map((body.fields ?? []).map((f) => [f.id, f.value]));
        const reqFields = await pool.query(`select id, required from field where recipient_id = $1`, [r.id]);
        for (const f of reqFields.rows) {
            if (f.required && !valueMap.get(f.id)) {
                return reply.code(400).send({ error: "Please complete all required fields." });
            }
        }
        const client = await pool.connect();
        try {
            await client.query("begin");
            for (const [fid, val] of valueMap) {
                await client.query(`update field set value = $1 where id = $2 and recipient_id = $3`, [
                    val,
                    fid,
                    r.id,
                ]);
            }
            await client.query(`update recipient set status = 'signed', signed_at = now(), consent_at = now(),
           ip = $1, user_agent = $2 where id = $3`, [ip, ua, r.id]);
            await client.query(`insert into event (envelope_id, actor, type, detail, ip) values ($1, $2, 'consented', $3, $4)`, [envId, r.email, "Consented to sign electronically", ip]);
            await client.query(`insert into event (envelope_id, actor, type, detail, ip) values ($1, $2, 'signed', $3, $4)`, [envId, r.email, r.name, ip]);
            await client.query("commit");
        }
        catch (e) {
            await client.query("rollback");
            client.release();
            throw e;
        }
        client.release();
        const pending = await pool.query(`select count(*)::int n from recipient where envelope_id = $1 and role = 'signer' and status <> 'signed'`, [envId]);
        let completed = false;
        if (pending.rows[0].n === 0) {
            await finalizeEnvelope(envId);
            completed = true;
        }
        else {
            // Sequential envelopes: email the next recipient in order now.
            const envRow = await pool.query(`select sequential, title from envelope where id = $1`, [envId]);
            if (envRow.rows[0]?.sequential) {
                const next = await pool.query(`select * from recipient where envelope_id = $1 and status = 'pending' order by sign_order limit 1`, [envId]);
                if (next.rowCount) {
                    const n = next.rows[0];
                    await pool.query(`update recipient set status = 'sent' where id = $1`, [n.id]);
                    await sendSigningInvite({
                        to: n.email,
                        recipientName: n.name,
                        senderName: "Axus Legal",
                        title: envRow.rows[0].title,
                        url: `${config.publicBaseUrl}/sign/${n.sign_token}`,
                    });
                }
            }
        }
        return { ok: true, completed };
    });
}
//# sourceMappingURL=sign.js.map
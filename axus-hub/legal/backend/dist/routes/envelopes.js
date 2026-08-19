import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";
import { getIdentity, hasLegalAccess } from "../identity.js";
import { sendSigningInvite } from "../mail.js";
function requireStaff(req, reply) {
    const id = getIdentity(req);
    if (!id || !hasLegalAccess(id)) {
        reply.code(403).send({ error: "Forbidden" });
        return null;
    }
    return id;
}
// Convert a Word/other document to PDF via Gotenberg (LibreOffice). Returns the
// stored PDF filename, or null if conversion failed.
async function convertToPdf(inputPath, originalName, envId) {
    try {
        const buf = await readFile(inputPath);
        const form = new FormData();
        form.append("files", new Blob([buf]), originalName);
        const res = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, {
            method: "POST",
            body: form,
        });
        if (!res.ok)
            return null;
        const pdf = Buffer.from(await res.arrayBuffer());
        const out = `${envId}-doc.pdf`;
        await writeFile(join(config.storageDir, out), pdf);
        return out;
    }
    catch {
        return null;
    }
}
export async function envelopeRoutes(app) {
    // List envelopes (most recent first).
    app.get("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const { rows } = await pool.query(`select id, title, status, created_by, created_at, sent_at, completed_at, pdf_file, doc_type, company
       from envelope order by created_at desc limit 200`);
        return { envelopes: rows };
    });
    // Create a draft envelope.
    app.post("/", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const body = (req.body ?? {});
        const title = (body.title ?? "Untitled document").toString().trim().slice(0, 200) || "Untitled document";
        const docType = body.doc_type?.trim() || null;
        const company = body.company?.trim() || null;
        const { rows } = await pool.query(`insert into envelope (title, created_by, doc_type, company) values ($1, $2, $3, $4) returning *`, [title, id.email, docType, company]);
        await pool.query(`insert into event (envelope_id, actor, type, detail) values ($1, $2, 'created', $3)`, [rows[0].id, id.email, title]);
        return reply.code(201).send({ envelope: rows[0] });
    });
    // Update envelope settings (currently: sequential signing order).
    app.patch("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const body = (req.body ?? {});
        if (typeof body.sequential === "boolean") {
            await pool.query(`update envelope set sequential = $1 where id = $2`, [body.sequential, envId]);
        }
        if (body.doc_type !== undefined) {
            await pool.query(`update envelope set doc_type = $1 where id = $2`, [body.doc_type?.trim() || null, envId]);
        }
        if (body.company !== undefined) {
            await pool.query(`update envelope set company = $1 where id = $2`, [body.company?.trim() || null, envId]);
        }
        const { rows } = await pool.query(`select * from envelope where id = $1`, [envId]);
        if (!rows.length)
            return reply.code(404).send({ error: "Not found" });
        return { envelope: rows[0] };
    });
    // Delete an envelope (and its recipients/fields/events + stored files).
    app.delete("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const env = await pool.query(`select source_file, pdf_file, sealed_file from envelope where id = $1`, [envId]);
        if (!env.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const r = env.rows[0];
        for (const f of [r.source_file, r.pdf_file, r.sealed_file]) {
            if (!f)
                continue;
            const p = join(config.storageDir, f);
            try {
                if (existsSync(p))
                    await unlink(p);
            }
            catch {
                /* best effort */
            }
        }
        await pool.query(`delete from envelope where id = $1`, [envId]); // cascades children
        return { ok: true };
    });
    // Fetch one envelope with its recipients + fields + events.
    app.get("/:id", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const env = await pool.query(`select * from envelope where id = $1`, [envId]);
        if (!env.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const recipients = await pool.query(`select id, envelope_id, name, email, role, sign_order, status, signed_at
       from recipient where envelope_id = $1 order by sign_order`, [envId]);
        const fields = await pool.query(`select * from field where envelope_id = $1`, [envId]);
        const events = await pool.query(`select actor, type, detail, ip, at from event where envelope_id = $1 order by at`, [envId]);
        return {
            envelope: env.rows[0],
            recipients: recipients.rows,
            fields: fields.rows,
            events: events.rows,
        };
    });
    // Upload the source document (PDF now; Word→PDF conversion via Gotenberg in Wk3).
    app.post("/:id/document", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const env = await pool.query(`select id from envelope where id = $1`, [envId]);
        if (!env.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const file = await req.file();
        if (!file)
            return reply.code(400).send({ error: "No file uploaded" });
        const ext = (file.filename.split(".").pop() ?? "bin").toLowerCase();
        const stored = `${envId}-source.${ext}`;
        await pipeline(file.file, createWriteStream(join(config.storageDir, stored)));
        // PDFs are signable as-is; Word/other are converted to PDF via Gotenberg.
        let pdfFile = null;
        if (ext === "pdf") {
            pdfFile = stored;
        }
        else {
            pdfFile = await convertToPdf(join(config.storageDir, stored), file.filename, envId);
        }
        await pool.query(`update envelope set source_file = $1, pdf_file = $2 where id = $3`, [
            stored,
            pdfFile,
            envId,
        ]);
        await pool.query(`insert into event (envelope_id, actor, type, detail) values ($1, $2, 'document_uploaded', $3)`, [envId, id.email, file.filename]);
        if (!pdfFile) {
            return reply
                .code(422)
                .send({ error: "Could not convert this file to PDF. Please upload a PDF or .docx." });
        }
        return { ok: true, file: stored, pdf: pdfFile };
    });
    // Stream the signing PDF (staff editor; a tokenized signer route comes later).
    app.get("/:id/document", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const env = await pool.query(`select pdf_file, source_file, sealed_file, status from envelope where id = $1`, [envId]);
        if (!env.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const row = env.rows[0];
        const fileName = row.status === "completed" && row.sealed_file
            ? row.sealed_file
            : (row.pdf_file ?? row.source_file);
        if (!fileName)
            return reply.code(404).send({ error: "No document uploaded" });
        const full = join(config.storageDir, fileName);
        if (!existsSync(full))
            return reply.code(404).send({ error: "File missing on disk" });
        reply.header("Content-Type", fileName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
        return reply.send(createReadStream(full));
    });
    // Replace the recipient list (client supplies stable UUIDs so fields can
    // reference them immediately). Removing a recipient cascades their fields.
    app.put("/:id/recipients", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const body = (req.body ?? {});
        const recips = body.recipients ?? [];
        const client = await pool.connect();
        try {
            await client.query("begin");
            const ids = recips.map((r) => r.id).filter(Boolean);
            if (ids.length) {
                await client.query(`delete from recipient where envelope_id = $1 and not (id = any($2::uuid[]))`, [envId, ids]);
            }
            else {
                await client.query(`delete from recipient where envelope_id = $1`, [envId]);
            }
            for (const [i, r] of recips.entries()) {
                await client.query(`insert into recipient (id, envelope_id, name, email, role, sign_order)
           values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
           on conflict (id) do update
             set name = excluded.name, email = excluded.email,
                 role = excluded.role, sign_order = excluded.sign_order`, [r.id ?? null, envId, r.name, r.email, r.role ?? "signer", r.sign_order ?? i + 1]);
            }
            await client.query("commit");
        }
        catch (e) {
            await client.query("rollback");
            throw e;
        }
        finally {
            client.release();
        }
        const { rows } = await pool.query(`select id, envelope_id, name, email, role, sign_order, status
       from recipient where envelope_id = $1 order by sign_order`, [envId]);
        return { recipients: rows };
    });
    // Replace all fields for the envelope (the editor owns the full set).
    app.put("/:id/fields", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const body = (req.body ?? {});
        const fields = body.fields ?? [];
        const client = await pool.connect();
        try {
            await client.query("begin");
            await client.query(`delete from field where envelope_id = $1`, [envId]);
            for (const f of fields) {
                await client.query(`insert into field (envelope_id, recipient_id, type, page, x, y, w, h, value, required)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                    envId,
                    f.recipient_id ?? null,
                    f.type,
                    f.page,
                    f.x,
                    f.y,
                    f.w,
                    f.h,
                    f.value ?? null,
                    f.required ?? true,
                ]);
            }
            await client.query("commit");
        }
        catch (e) {
            await client.query("rollback");
            throw e;
        }
        finally {
            client.release();
        }
        return { ok: true };
    });
    // Send the envelope: token each recipient, email their signing link, lock it.
    app.post("/:id/send", async (req, reply) => {
        const id = requireStaff(req, reply);
        if (!id)
            return;
        const envId = req.params.id;
        const envq = await pool.query(`select * from envelope where id = $1`, [envId]);
        if (!envq.rowCount)
            return reply.code(404).send({ error: "Not found" });
        const env = envq.rows[0];
        if (!env.pdf_file)
            return reply.code(400).send({ error: "Upload a document first." });
        if (env.status !== "draft")
            return reply.code(409).send({ error: "This document has already been sent." });
        const recips = await pool.query(`select * from recipient where envelope_id = $1 order by sign_order`, [envId]);
        if (!recips.rowCount)
            return reply.code(400).send({ error: "Add at least one recipient." });
        const fieldCounts = await pool.query(`select recipient_id, count(*)::int n from field where envelope_id = $1 group by recipient_id`, [envId]);
        const withFields = new Set(fieldCounts.rows.filter((r) => r.recipient_id).map((r) => r.recipient_id));
        const missing = recips.rows.filter((r) => r.role === "signer" && !withFields.has(r.id));
        if (missing.length) {
            return reply
                .code(400)
                .send({ error: `Add at least one field for: ${missing.map((m) => m.name).join(", ")}` });
        }
        const results = [];
        const tokens = new Map();
        for (const r of recips.rows)
            tokens.set(r.id, randomBytes(24).toString("base64url"));
        const invite = (r) => sendSigningInvite({
            to: r.email,
            recipientName: r.name,
            senderName: id.name,
            title: env.title,
            url: `${config.publicBaseUrl}/sign/${tokens.get(r.id)}`,
        });
        if (env.sequential) {
            // Only the first recipient is emailed now; the rest advance as each signs.
            const firstId = recips.rows[0].id;
            for (const r of recips.rows) {
                await pool.query(`update recipient set sign_token = $1, status = $2 where id = $3`, [
                    tokens.get(r.id),
                    r.id === firstId ? "sent" : "pending",
                    r.id,
                ]);
            }
            results.push({ email: recips.rows[0].email, sent: await invite(recips.rows[0]) });
        }
        else {
            for (const r of recips.rows) {
                await pool.query(`update recipient set sign_token = $1, status = 'sent' where id = $2`, [
                    tokens.get(r.id),
                    r.id,
                ]);
                results.push({ email: r.email, sent: await invite(r) });
            }
        }
        await pool.query(`update envelope set status = 'sent', sent_at = now() where id = $1`, [envId]);
        await pool.query(`insert into event (envelope_id, actor, type, detail) values ($1, $2, 'sent', $3)`, [envId, id.email, `Sent to ${recips.rowCount} recipient(s)`]);
        return { ok: true, results };
    });
}
//# sourceMappingURL=envelopes.js.map
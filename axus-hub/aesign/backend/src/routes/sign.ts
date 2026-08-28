// PUBLIC signer routes (no Authentik). Access is by unguessable per-recipient
// token. Traefik routes /api/sign and /sign here without the auth middleware.
import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sealPdf, type SealField, type SealRecipient } from "../seal.js";
import { sendCompleted, sendProgress, sendReminder, sendDeclined } from "../mail.js";
import { envelopeDocName } from "../docname.js";
import { logActivity } from "./activity.js";
import { isOnCallQuote, notifyOnCallQuoteCompleted } from "../oncall.js";

// Seal the CURRENT state and email every participant a copy. On the last
// signature it adds the certificate page, marks the envelope completed, and
// stores the sealed file. Returns whether it's now fully complete.
async function sealAndNotify(envId: string, signerName: string): Promise<boolean> {
  const env = await pool.query(
    `select id, title, pdf_file, sequential, created_by, doc_type, company, quote_data from envelope where id = $1`,
    [envId],
  );
  const e = env.rows[0];
  if (!e?.pdf_file) return false;
  const fields = await pool.query(
    `select type, page, x, y, w, h, value from field where envelope_id = $1`,
    [envId],
  );
  const recs = await pool.query(
    `select id, name, email, sign_token, ip, status,
            to_char(signed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"') as signed_at
     from recipient where envelope_id = $1 order by sign_order`,
    [envId],
  );
  const allSigned = recs.rows.every((r) => r.status === "signed");
  logActivity(signerName, "Signed document", e.title, e.id);

  const { bytes, sha256 } = await sealPdf(
    join(config.storageDir, e.pdf_file),
    fields.rows as SealField[],
    recs.rows as SealRecipient[],
    { title: e.title, envelopeId: e.id },
    allSigned,
  );
  const attachment = { filename: `${envelopeDocName(e)}.pdf`, content: Buffer.from(bytes) };

  if (allSigned) {
    const sealedName = `${envId}-sealed.pdf`;
    await writeFile(join(config.storageDir, sealedName), bytes);
    await pool.query(
      `update envelope set status = 'completed', completed_at = now(), sealed_file = $1, sha256 = $2 where id = $3`,
      [sealedName, sha256, envId],
    );
    await pool.query(
      `insert into event (envelope_id, actor, type, detail) values ($1, 'system', 'completed', $2)`,
      [envId, `Sealed. SHA-256 ${sha256}`],
    );
    logActivity("system", "Completed document", e.title, e.id);
    for (const r of recs.rows) {
      await sendCompleted({ to: r.email, recipientName: r.name, title: e.title, attachment });
    }
    // Also notify the sender (staff) with the final signed copy.
    if (e.created_by && !recs.rows.some((r) => r.email === e.created_by)) {
      await sendCompleted({ to: e.created_by, recipientName: "Axus Team", title: e.title, attachment });
    }
    // If this is an On Call quote, notify On Call so it shows under Invoices.
    // Fire-and-forget (the helper never throws) so completion stays snappy.
    if (isOnCallQuote(e)) {
      void notifyOnCallQuoteCompleted(e, bytes, sha256, recs.rows as { name: string; email: string; signed_at?: string | null }[]);
    }
  } else {
    await pool.query(
      `update envelope set status = 'partially_completed' where id = $1 and status not in ('cancelled', 'completed')`,
      [envId],
    );
    // Notify EVERY participant that a part was completed; anyone who hasn't
    // signed yet also gets a "please complete your part" email with their link.
    for (const r of recs.rows) {
      if (r.status === "signed") {
        await sendProgress({
          to: r.email,
          recipientName: r.name,
          title: e.title,
          signerName,
          attachment,
        });
      } else {
        if (r.status === "pending") {
          await pool.query(`update recipient set status = 'sent' where id = $1`, [r.id]);
        }
        await sendReminder({
          to: r.email,
          recipientName: r.name,
          signerName,
          title: e.title,
          url: `${config.publicBaseUrl}/sign/${r.sign_token}`,
        });
      }
    }
  }
  return allSigned;
}

export async function signRoutes(app: FastifyInstance) {
  // Signer's view of the document + their fields.
  app.get("/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const rec = await pool.query(`select * from recipient where sign_token = $1`, [token]);
    if (!rec.rowCount) return reply.code(404).send({ error: "This signing link is invalid or has expired." });
    const r = rec.rows[0];
    const env = await pool.query(`select id, title, status from envelope where id = $1`, [r.envelope_id]);
    const fields = await pool.query(
      `select id, type, page, x, y, w, h, value, required from field where recipient_id = $1 order by page`,
      [r.id],
    );
    return {
      envelope: env.rows[0],
      recipient: { name: r.name, email: r.email, status: r.status },
      fields: fields.rows,
      alreadySigned: r.status === "signed",
    };
  });

  // Stream the PDF (sealed copy once completed, otherwise the working PDF).
  app.get("/:token/document", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const rec = await pool.query(
      `select e.pdf_file, e.sealed_file, e.status
       from recipient r join envelope e on e.id = r.envelope_id where r.sign_token = $1`,
      [token],
    );
    if (!rec.rowCount) return reply.code(404).send({ error: "Not found" });
    const row = rec.rows[0];
    const fileName = row.status === "completed" && row.sealed_file ? row.sealed_file : row.pdf_file;
    if (!fileName) return reply.code(404).send({ error: "No document" });
    const full = join(config.storageDir, fileName);
    if (!existsSync(full)) return reply.code(404).send({ error: "File missing" });
    reply.header("Content-Type", "application/pdf");
    return reply.send(createReadStream(full));
  });

  // Complete signing: record consent + field values + attribution, seal if last.
  app.post("/:token/complete", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const body = (req.body ?? {}) as { consent?: boolean; fields?: { id: string; value: string }[] };
    if (!body.consent) {
      return reply.code(400).send({ error: "You must consent to sign electronically." });
    }
    const rec = await pool.query(`select * from recipient where sign_token = $1`, [token]);
    if (!rec.rowCount) return reply.code(404).send({ error: "Invalid link" });
    const r = rec.rows[0];
    if (r.status === "signed") return reply.code(409).send({ error: "You have already signed." });

    const envId = r.envelope_id;
    const envStatus = await pool.query(`select status from envelope where id = $1`, [envId]);
    const st = envStatus.rows[0]?.status;
    if (st === "cancelled" || st === "declined") {
      return reply.code(409).send({ error: `This document has been ${st}.` });
    }
    const ip = req.ip;
    const ua = (req.headers["user-agent"] as string) ?? "";
    const valueMap = new Map((body.fields ?? []).map((f) => [f.id, f.value]));

    const reqFields = await pool.query(
      `select id, required from field where recipient_id = $1`,
      [r.id],
    );
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
      await client.query(
        `update recipient set status = 'signed', signed_at = now(), consent_at = now(),
           ip = $1, user_agent = $2 where id = $3`,
        [ip, ua, r.id],
      );
      await client.query(
        `insert into event (envelope_id, actor, type, detail, ip) values ($1, $2, 'consented', $3, $4)`,
        [envId, r.email, "Consented to sign electronically", ip],
      );
      await client.query(
        `insert into event (envelope_id, actor, type, detail, ip) values ($1, $2, 'signed', $3, $4)`,
        [envId, r.email, r.name, ip],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      client.release();
      throw e;
    }
    client.release();

    // Seal + email the current copy to everyone (final copy when all signed).
    const completed = await sealAndNotify(envId, r.name);
    return { ok: true, completed };
  });

  // Decline to sign — requires a reason of >= 10 words. Blocks the whole
  // document (status 'declined') and notifies the sender + other participants.
  app.post("/:token/decline", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const body = (req.body ?? {}) as { reason?: string };
    const reason = (body.reason ?? "").trim();
    if (reason.split(/\s+/).filter(Boolean).length < 10) {
      return reply
        .code(400)
        .send({ error: "Please explain why you're declining, in at least 10 words." });
    }
    const rec = await pool.query(`select * from recipient where sign_token = $1`, [token]);
    if (!rec.rowCount) return reply.code(404).send({ error: "Invalid link" });
    const r = rec.rows[0];
    if (r.status === "signed") return reply.code(409).send({ error: "You have already signed." });
    if (r.status === "declined") return reply.code(409).send({ error: "You have already declined." });

    const envId = r.envelope_id;
    const envq = await pool.query(`select title, created_by, status from envelope where id = $1`, [envId]);
    const env = envq.rows[0];
    if (!env) return reply.code(404).send({ error: "Not found" });
    if (env.status === "completed" || env.status === "cancelled") {
      return reply.code(409).send({ error: `This document is already ${env.status}.` });
    }

    const ip = req.ip;
    const ua = (req.headers["user-agent"] as string) ?? "";
    await pool.query(
      `update recipient set status = 'declined', declined_at = now(), decline_reason = $1,
         ip = $2, user_agent = $3 where id = $4`,
      [reason, ip, ua, r.id],
    );
    await pool.query(`update envelope set status = 'declined' where id = $1`, [envId]);
    await pool.query(
      `insert into event (envelope_id, actor, type, detail, ip) values ($1, $2, 'declined', $3, $4)`,
      [envId, r.email, reason, ip],
    );
    logActivity(r.email, "Declined document", env.title, envId);

    // Notify the sender + every other participant, with the reason.
    const others = await pool.query(
      `select name, email from recipient where envelope_id = $1 and id <> $2`,
      [envId, r.id],
    );
    const notify = [
      { name: "Axus Team", email: env.created_by as string },
      ...others.rows.map((o) => ({ name: o.name as string, email: o.email as string })),
    ];
    for (const p of notify) {
      if (!p.email) continue;
      await sendDeclined({ to: p.email, recipientName: p.name, declinerName: r.name, title: env.title, reason });
    }
    return { ok: true, declined: true };
  });
}

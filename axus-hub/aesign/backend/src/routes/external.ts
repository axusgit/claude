// Server-to-server intake for OTHER Axus products (currently the On Call AI
// Agent) to create quotes in eSign without an interactive Authentik login.
//
// This router is exposed OUTSIDE the Authentik forward-auth middleware (see the
// `aesign-public` Traefik rule in infra/docker-compose.yml), so the ONLY gate is
// a shared bearer secret (EXTERNAL_API_TOKEN). It reuses the exact quote engine
// and persistence as the staff route (quotes.ts): assign number → render the
// letterhead PDF → persist a Quote envelope → (optionally) add the client as a
// signer and send the signing link. The caller supplies field data; eSign owns
// the format, number, layout and letterhead.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";
import { generateQuotePdf, type QuoteData } from "../quotepdf.js";
import { sendSigningInvite } from "../mail.js";
import { logActivity } from "./activity.js";

// Today's date in Eastern Time as MMDDYYYY (the quote-number prefix). Mirrors quotes.ts.
function etDatePrefix(): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("month")}${get("day")}${get("year")}`;
}

// Constant-time bearer-secret check. Returns true if the request carries the
// configured EXTERNAL_API_TOKEN; otherwise replies 401/503 and returns false.
function requireToken(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = config.externalToken;
  if (!expected) {
    reply.code(503).send({ error: "External API is not configured." });
    return false;
  }
  const raw = req.headers["authorization"];
  const hdr = Array.isArray(raw) ? raw[0] : raw;
  const token = hdr && hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function externalRoutes(app: FastifyInstance) {
  // Create a Quote from an external product. Body:
  //   { quote: QuoteData, recipient: { name, email }, send?: boolean,
  //     senderName?: string, createdBy?: string }
  // When send=true the client is added as the signer and emailed a signing link
  // (the whole point of eSign). When send=false the Quote is created as a draft
  // (used for dry-run/testing) — the caller can review it in the eSign UI.
  app.post("/quotes", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const body = (req.body ?? {}) as {
      quote?: QuoteData;
      recipient?: { name?: string; email?: string };
      send?: boolean;
      senderName?: string;
      createdBy?: string;
    };
    const q = body.quote;
    if (!q || !q.customer?.company?.trim()) {
      return reply.code(400).send({ error: "A customer company is required." });
    }
    const send = body.send === true;
    const recipEmail = (body.recipient?.email ?? "").trim().toLowerCase();
    const recipName = (body.recipient?.name ?? "").trim() || q.customer.contact?.trim() || q.customer.company.trim();
    if (send && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipEmail)) {
      return reply.code(400).send({ error: "A valid recipient email is required to send for signature." });
    }
    const createdBy = (body.createdBy ?? "").trim() || "oncall@axustechnologies.com";
    const senderName = (body.senderName ?? "").trim() || "Axus Technologies";

    // Auto quote number: MMDDYYYY.### (### = next in sequence for today, ET).
    const prefix = etDatePrefix();
    const cnt = await pool.query(
      `select count(*)::int n from envelope where doc_type = 'Quote' and quote_data->>'quote_number' like $1`,
      [`${prefix}.%`],
    );
    q.quote_number = `${prefix}.${String(cnt.rows[0].n + 1).padStart(3, "0")}`;
    const title = `${q.customer.company.trim()} — Quote ${q.quote_number}`.slice(0, 200);

    // Render + persist the Quote envelope (identical to quotes.ts create).
    const { bytes, layout } = await generateQuotePdf(q);
    const env = await pool.query(
      `insert into envelope (title, created_by, doc_type, company, quote_data, field_layout)
       values ($1, $2, 'Quote', $3, $4, $5) returning id`,
      [title, createdBy, q.customer.company.trim(), JSON.stringify(q), JSON.stringify(layout)],
    );
    const envId = env.rows[0].id;
    const fname = `${envId}-quote.pdf`;
    await writeFile(join(config.storageDir, fname), Buffer.from(bytes));
    await pool.query(`update envelope set source_file = $1, pdf_file = $1 where id = $2`, [fname, envId]);
    await pool.query(
      `insert into event (envelope_id, actor, type, detail) values ($1, $2, 'created', $3)`,
      [envId, createdBy, `${title} (via ${createdBy})`],
    );
    logActivity(createdBy, "Created quote", title, envId);

    // Add the customer as the sole signer and auto-place their fields from the
    // quote's returned signature layout (the "Customer" slot).
    const rec = await pool.query(
      `insert into recipient (envelope_id, name, email, role, sign_order)
       values ($1, $2, $3, 'signer', 1) returning id`,
      [envId, recipName, recipEmail || "unknown@example.com"],
    );
    const recipientId = rec.rows[0].id;
    const slot = (layout ?? []).find((s) => s.role === "Customer") ?? layout?.[0];
    let fieldCount = 0;
    for (const f of slot?.fields ?? []) {
      await pool.query(
        `insert into field (envelope_id, recipient_id, type, page, x, y, w, h, required)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [envId, recipientId, f.type, f.page, f.x, f.y, f.w, f.h],
      );
      fieldCount++;
    }

    let signUrl: string | null = null;
    if (send && fieldCount > 0) {
      const token = randomBytes(24).toString("base64url");
      await pool.query(`update recipient set sign_token = $1, status = 'sent' where id = $2`, [token, recipientId]);
      await pool.query(`update envelope set status = 'sent', sent_at = now() where id = $1`, [envId]);
      await pool.query(
        `insert into event (envelope_id, actor, type, detail) values ($1, $2, 'sent', $3)`,
        [envId, createdBy, `Sent to ${recipEmail}`],
      );
      signUrl = `${config.publicBaseUrl}/sign/${token}`;
      const sent = await sendSigningInvite({
        to: recipEmail,
        recipientName: recipName,
        senderName,
        title,
        url: signUrl,
      });
      logActivity(createdBy, "Sent for signature", `${title} → ${recipEmail}`, envId);
      return reply.code(201).send({
        envelopeId: envId,
        quoteNumber: q.quote_number,
        recipientId,
        status: "sent",
        emailSent: sent,
        signUrl,
      });
    }

    // Draft (send=false, or no signature fields): created but not emailed.
    return reply.code(201).send({
      envelopeId: envId,
      quoteNumber: q.quote_number,
      recipientId,
      status: "draft",
      emailSent: false,
      signUrl: null,
    });
  });
}

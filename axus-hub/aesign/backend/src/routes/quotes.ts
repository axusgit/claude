import type { FastifyInstance } from "fastify";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { config } from "../config.js";
import { requireStaff } from "../identity.js";
import { generateQuotePdf, generateQuoteTemplatePdf, type QuoteData, type SignSlot } from "../quotepdf.js";
import { logActivity, renameActivity } from "./activity.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type QuoteRecipient = { name?: string; email?: string };

// Today's date in Eastern Time as MMDDYYYY (the quote-number prefix).
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

// Auto-sync a quote's signer to match its contact: replace the envelope's
// recipients + fields with a single "Customer" signer and the layout's signature
// fields. No-op when no valid contact email is supplied (leaves recipients as-is),
// so removing the contact doesn't wipe a manually-managed recipient.
async function syncQuoteRecipient(
  envId: string,
  recipient: QuoteRecipient | undefined,
  layout: SignSlot[] | undefined,
): Promise<void> {
  const email = (recipient?.email ?? "").trim().toLowerCase();
  const name = (recipient?.name ?? "").trim();
  if (!name || !EMAIL_RE.test(email)) return;
  await pool.query(`delete from field where envelope_id = $1`, [envId]);
  await pool.query(`delete from recipient where envelope_id = $1`, [envId]);
  const rec = await pool.query(
    `insert into recipient (envelope_id, name, email, role, sign_order)
     values ($1, $2, $3, 'signer', 1) returning id`,
    [envId, name, email],
  );
  const recipientId = rec.rows[0].id;
  const slot = (layout ?? []).find((s) => s.role === "Customer") ?? layout?.[0];
  for (const f of slot?.fields ?? []) {
    await pool.query(
      `insert into field (envelope_id, recipient_id, type, page, x, y, w, h, required)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [envId, recipientId, f.type, f.page, f.x, f.y, f.w, f.h],
    );
  }
}

export async function quoteRoutes(app: FastifyInstance) {
  // Download a blank, Axus-branded quote template for sales to fill in and hand
  // back (they upload the finished .pdf/.doc when creating a Quote).
  app.get("/template", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const bytes = await generateQuoteTemplatePdf();
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", 'attachment; filename="Axus-Quote-Template.pdf"');
    return reply.send(Buffer.from(bytes));
  });

  // Create a Quote — generates the branded PDF and a Quote envelope.
  app.post("/", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const body = (req.body ?? {}) as { title?: string; quote?: QuoteData; recipient?: QuoteRecipient };
    const q = body.quote;
    if (!q || !q.customer?.company?.trim()) {
      return reply.code(400).send({ error: "A customer company is required." });
    }
    // Auto quote number: MMDDYYYY.### (### = next in sequence for today, ET).
    const prefix = etDatePrefix();
    const cnt = await pool.query(
      `select count(*)::int n from envelope where doc_type = 'Quote' and quote_data->>'quote_number' like $1`,
      [`${prefix}.%`],
    );
    q.quote_number = `${prefix}.${String(cnt.rows[0].n + 1).padStart(3, "0")}`;
    const title = `${q.customer.company.trim()} — Quote ${q.quote_number}`.slice(0, 200);

    const { bytes, layout } = await generateQuotePdf(q);
    const env = await pool.query(
      `insert into envelope (title, created_by, doc_type, company, quote_data, field_layout)
       values ($1, $2, 'Quote', $3, $4, $5) returning id`,
      [title, id.email, q.customer.company.trim(), JSON.stringify(q), JSON.stringify(layout)],
    );
    const envId = env.rows[0].id;
    const fname = `${envId}-quote.pdf`;
    await writeFile(join(config.storageDir, fname), Buffer.from(bytes));
    await pool.query(`update envelope set source_file = $1, pdf_file = $1 where id = $2`, [fname, envId]);
    await pool.query(
      `insert into event (envelope_id, actor, type, detail) values ($1, $2, 'created', $3)`,
      [envId, id.email, title],
    );
    // Auto-add the signer to match the quote's contact.
    await syncQuoteRecipient(envId, body.recipient, layout);
    const updated = await pool.query(`select * from envelope where id = $1`, [envId]);
    logActivity(id.email, "Created quote", title, envId);
    return reply.code(201).send({ envelope: updated.rows[0] });
  });

  // Regenerate a draft Quote's PDF from edited data.
  app.put("/:id", async (req, reply) => {
    const id = requireStaff(req, reply);
    if (!id) return;
    const envId = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { quote?: QuoteData; title?: string; recipient?: QuoteRecipient };
    const q = body.quote;
    if (!q?.customer?.company?.trim()) return reply.code(400).send({ error: "A customer company is required." });
    const cur = await pool.query(`select status, quote_data from envelope where id = $1`, [envId]);
    if (!cur.rowCount) return reply.code(404).send({ error: "Not found" });
    if (cur.rows[0].status !== "draft") {
      return reply.code(409).send({ error: "Only draft quotes can be edited." });
    }
    // Preserve caller-supplied fields the quote EDITOR doesn't manage (e.g. the
    // On Call preliminary-quote clause added via /api/external) so that editing a
    // quote in eSign — adding a company, changing an item — never drops them.
    const prev = (cur.rows[0].quote_data ?? {}) as Partial<QuoteData>;
    if (prev.terms_addendum && !q.terms_addendum) q.terms_addendum = prev.terms_addendum;
    if (prev.terms_addendum_heading && !q.terms_addendum_heading) q.terms_addendum_heading = prev.terms_addendum_heading;
    const { bytes, layout } = await generateQuotePdf(q);
    const fname = `${envId}-quote.pdf`;
    await writeFile(join(config.storageDir, fname), Buffer.from(bytes));
    // Keep the standard "<Company> — Quote <number>" title on edit (the editor
    // otherwise sends a plain "<Company> Quote", dropping the quote number).
    const num = (q.quote_number || prev.quote_number || "").trim();
    const newTitle = (num
      ? `${q.customer.company.trim()} — Quote ${num}`
      : `${q.customer.company.trim()} Quote`).slice(0, 200);
    await pool.query(
      `update envelope set quote_data = $1, company = $2, source_file = $3, pdf_file = $3,
              field_layout = $4, title = $5 where id = $6`,
      [JSON.stringify(q), q.customer.company.trim(), fname, JSON.stringify(layout), newTitle, envId],
    );
    // Keep the signer in sync with the quote's contact on edit.
    await syncQuoteRecipient(envId, body.recipient, layout);
    const updated = await pool.query(`select * from envelope where id = $1`, [envId]);
    renameActivity(envId, newTitle);
    return { envelope: updated.rows[0] };
  });
}

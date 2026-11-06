import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { atrsRole, requireAdmin, requireUser } from "../identity.js";
import { hoursBetween, normalizeHm } from "../time.js";
import { config } from "../config.js";
import { sendDecision, sendSubmitted } from "../mail.js";

const SELECT = `
  select e.id, e.worker_email, w.name as worker_name,
         to_char(e.work_date, 'YYYY-MM-DD') as work_date,
         to_char(e.start_time, 'HH24:MI') as start_time,
         to_char(e.end_time, 'HH24:MI') as end_time,
         e.hours::float8 as hours, e.task, e.category, e.status,
         e.submitted_at, e.decided_at, e.decided_by, e.decision_note,
         e.created_at, e.updated_at
         , coalesce(w.rate, 0)::float8 as rate
  from time_entry e
  left join worker w on w.email = e.worker_email
`;

// Entries are editable only before/while they're being reworked.
const EDITABLE = ["draft", "rejected"];

// Time categories. 'work' is billable/worked time; the rest are leave types.
// All use the same date + start/end → hours model and the same approval flow.
const CATEGORIES = ["work", "pto", "holiday", "sick", "unpaid"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  work: "Work",
  pto: "PTO",
  holiday: "Holiday",
  sick: "Sick",
  unpaid: "Unpaid leave",
};

type EntryBody = { work_date?: string; start_time?: string; end_time?: string; task?: string; category?: string };

// Validate + normalize a create/update body. Returns the cleaned values or an
// error string.
function cleanEntry(b: EntryBody): { work_date: string; start_time: string; end_time: string; task: string; hours: number; category: Category } | string {
  const category = (b.category ?? "work").trim().toLowerCase() as Category;
  if (!CATEGORIES.includes(category)) return "Please choose a valid category.";
  const work_date = (b.work_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) return "A valid date is required.";
  const start_time = normalizeHm(b.start_time ?? "");
  const end_time = normalizeHm(b.end_time ?? "");
  if (!start_time) return "A valid start time is required.";
  if (!end_time) return "A valid end time is required.";
  let task = (b.task ?? "").trim();
  // A description is required for worked time; for leave it's optional and
  // defaults to the category label so lists/exports read sensibly.
  if (category === "work" && !task) return "A task description is required.";
  if (!task) task = CATEGORY_LABEL[category];
  if (task.length > 2000) return "Task description is too long (2000 characters max).";
  const hours = hoursBetween(start_time, end_time);
  if (hours === null || hours <= 0) return "End time must be after start time.";
  if (hours > 24) return "An entry can't exceed 24 hours.";
  return { work_date, start_time, end_time, task, hours, category };
}

function rangeLabel(dates: string[]): string {
  if (!dates.length) return "—";
  const sorted = [...dates].sort();
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  return a === b ? a : `${a} → ${b}`;
}

export async function entryRoutes(app: FastifyInstance) {
  // --- list -----------------------------------------------------------------
  app.get("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const admin = atrsRole(id) === "admin";
    const qs = req.query as { scope?: string; status?: string; from?: string; to?: string; worker?: string };

    const where: string[] = [];
    const params: unknown[] = [];
    // Contractors only ever see their own; admins may see all or filter by worker.
    if (!admin || qs.scope === "mine") {
      params.push(id.email.toLowerCase());
      where.push(`e.worker_email = $${params.length}`);
    } else if (qs.worker) {
      params.push(qs.worker.toLowerCase());
      where.push(`e.worker_email = $${params.length}`);
    }
    if (qs.status) {
      params.push(qs.status);
      where.push(`e.status = $${params.length}`);
    }
    if (qs.from && /^\d{4}-\d{2}-\d{2}$/.test(qs.from)) {
      params.push(qs.from);
      where.push(`e.work_date >= $${params.length}`);
    }
    if (qs.to && /^\d{4}-\d{2}-\d{2}$/.test(qs.to)) {
      params.push(qs.to);
      where.push(`e.work_date <= $${params.length}`);
    }
    const sql = SELECT + (where.length ? ` where ${where.join(" and ")}` : "") +
      ` order by e.work_date desc, e.start_time desc, e.created_at desc`;
    const rows = (await pool.query(sql, params)).rows;
    return { entries: rows, role: atrsRole(id) };
  });

  // --- create (always a draft, for the signed-in worker) --------------------
  app.post("/", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const clean = cleanEntry((req.body ?? {}) as EntryBody);
    if (typeof clean === "string") return reply.code(400).send({ error: clean });
    const row = (
      await pool.query(
        `insert into time_entry (worker_email, work_date, start_time, end_time, hours, task, category)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [id.email.toLowerCase(), clean.work_date, clean.start_time, clean.end_time, clean.hours, clean.task, clean.category],
      )
    ).rows[0];
    return { ok: true, id: row.id };
  });

  // --- update (own, only while draft/rejected) ------------------------------
  app.patch("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const entryId = (req.params as { id: string }).id;
    const cur = (await pool.query(`select worker_email, status from time_entry where id = $1`, [entryId])).rows[0];
    if (!cur) return reply.code(404).send({ error: "Not found" });
    if (cur.worker_email !== id.email.toLowerCase()) return reply.code(403).send({ error: "Not your entry" });
    if (!EDITABLE.includes(cur.status)) {
      return reply.code(409).send({ error: "Only draft or returned entries can be edited." });
    }
    const clean = cleanEntry((req.body ?? {}) as EntryBody);
    if (typeof clean === "string") return reply.code(400).send({ error: clean });
    await pool.query(
      `update time_entry set work_date = $1, start_time = $2, end_time = $3, hours = $4, task = $5,
         category = $6, status = 'draft', decision_note = null, updated_at = now() where id = $7`,
      [clean.work_date, clean.start_time, clean.end_time, clean.hours, clean.task, clean.category, entryId],
    );
    return { ok: true };
  });

  // --- delete (own, only while draft/rejected) ------------------------------
  app.delete("/:id", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const entryId = (req.params as { id: string }).id;
    const cur = (await pool.query(`select worker_email, status from time_entry where id = $1`, [entryId])).rows[0];
    if (!cur) return reply.code(404).send({ error: "Not found" });
    if (cur.worker_email !== id.email.toLowerCase()) return reply.code(403).send({ error: "Not your entry" });
    if (!EDITABLE.includes(cur.status)) {
      return reply.code(409).send({ error: "Only draft or returned entries can be deleted." });
    }
    await pool.query(`delete from time_entry where id = $1`, [entryId]);
    return { ok: true };
  });

  // --- submit for approval (own draft/rejected entries) ---------------------
  app.post("/submit", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const ids = ((req.body ?? {}) as { ids?: string[] }).ids ?? [];
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: "Nothing selected to submit." });
    const email = id.email.toLowerCase();
    const upd = await pool.query(
      `update time_entry set status = 'submitted', submitted_at = now(), decision_note = null, updated_at = now()
       where id = any($1::uuid[]) and worker_email = $2 and status in ('draft','rejected')
       returning to_char(work_date,'YYYY-MM-DD') as work_date, hours::float8 as hours`,
      [ids, email],
    );
    if (!upd.rowCount) return reply.code(409).send({ error: "No eligible entries to submit." });
    const count = upd.rowCount;
    const totalHours = Math.round(upd.rows.reduce((s, r) => s + Number(r.hours), 0) * 100) / 100;
    const label = rangeLabel(upd.rows.map((r) => r.work_date));
    // Notify the approver (non-fatal if mail fails).
    void sendSubmitted({
      to: config.mail.approverTo,
      workerName: id.name,
      count,
      totalHours,
      rangeLabel: label,
      url: `${config.publicBaseUrl}/approvals`,
    });
    return { ok: true, submitted: count };
  });

  // --- approve / reject (admin) ---------------------------------------------
  app.post("/decide", async (req, reply) => {
    const id = requireAdmin(req, reply);
    if (!id) return;
    const body = (req.body ?? {}) as { ids?: string[]; decision?: string; note?: string };
    const ids = body.ids ?? [];
    const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
    if (!decision) return reply.code(400).send({ error: "decision must be 'approved' or 'rejected'." });
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: "Nothing selected." });
    const note = (body.note ?? "").trim() || null;
    if (decision === "rejected" && !note) {
      return reply.code(400).send({ error: "A note is required when returning time for changes." });
    }
    const upd = await pool.query(
      `update time_entry set status = $1, decided_at = now(), decided_by = $2, decision_note = $3, updated_at = now()
       where id = any($4::uuid[]) and status = 'submitted'
       returning worker_email, to_char(work_date,'YYYY-MM-DD') as work_date, hours::float8 as hours`,
      [decision, id.email.toLowerCase(), note, ids],
    );
    if (!upd.rowCount) return reply.code(409).send({ error: "No submitted entries matched." });

    // Group affected entries by contractor and email each one a summary.
    const byWorker = new Map<string, { dates: string[]; hours: number }>();
    for (const r of upd.rows) {
      const g = byWorker.get(r.worker_email) ?? { dates: [], hours: 0 };
      g.dates.push(r.work_date);
      g.hours += Number(r.hours);
      byWorker.set(r.worker_email, g);
    }
    for (const [workerEmail, g] of byWorker) {
      const w = (await pool.query(`select name from worker where email = $1`, [workerEmail])).rows[0];
      void sendDecision({
        to: workerEmail,
        workerName: w?.name ?? workerEmail,
        approved: decision === "approved",
        count: g.dates.length,
        totalHours: Math.round(g.hours * 100) / 100,
        rangeLabel: rangeLabel(g.dates),
        note: note ?? undefined,
        url: `${config.publicBaseUrl}/`,
      });
    }
    return { ok: true, decided: upd.rowCount };
  });

  // --- totals summary -------------------------------------------------------
  // Contractor: their own hours grouped by status. Admin: hours per worker
  // (and overall) for the optional date range, so a period can be totalled for
  // invoicing/payment.
  app.get("/summary", async (req, reply) => {
    const id = requireUser(req, reply);
    if (!id) return;
    const admin = atrsRole(id) === "admin";
    const qs = req.query as { from?: string; to?: string };
    const where: string[] = [];
    const params: unknown[] = [];
    if (!admin) {
      params.push(id.email.toLowerCase());
      where.push(`e.worker_email = $${params.length}`);
    }
    if (qs.from && /^\d{4}-\d{2}-\d{2}$/.test(qs.from)) {
      params.push(qs.from);
      where.push(`e.work_date >= $${params.length}`);
    }
    if (qs.to && /^\d{4}-\d{2}-\d{2}$/.test(qs.to)) {
      params.push(qs.to);
      where.push(`e.work_date <= $${params.length}`);
    }
    const whereSql = where.length ? ` where ${where.join(" and ")}` : "";

    const byStatus = (
      await pool.query(
        `select e.status, count(*)::int as n, coalesce(sum(e.hours),0)::float8 as hours
         from time_entry e${whereSql} group by e.status`,
        params,
      )
    ).rows;

    if (!admin) return { byStatus };

    const byWorker = (
      await pool.query(
        `select e.worker_email, w.name as worker_name,
                coalesce(sum(e.hours) filter (where e.status = 'submitted'),0)::float8 as submitted_hours,
                coalesce(sum(e.hours) filter (where e.status = 'approved'),0)::float8 as approved_hours,
                count(*) filter (where e.status = 'submitted')::int as submitted_n
         from time_entry e left join worker w on w.email = e.worker_email${whereSql}
         group by e.worker_email, w.name order by w.name nulls last`,
        params,
      )
    ).rows;
    return { byStatus, byWorker };
  });
}

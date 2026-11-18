// Standalone reminder runner — invoked every 15 min by cron:
//   docker compose exec -T aesign node dist/reminders.js
// Emails signers who haven't completed a sent/partially-completed document, on
// the schedule set per document (daily @time, weekly @dow+time, monthly @dom+time)
// interpreted in Eastern Time. Fires once per scheduled day, after the time.
import { pool } from "./db.js";
import { config } from "./config.js";
import { sendContractExpiryReminder, sendPendingReminder } from "./mail.js";

const TZ = "America/New_York";
const RECYCLE_DAYS = 90; // Recycle Bin retention: after this long, deleted docs auto-move to the Archive

function etParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p = fmt.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    day: parseInt(get("day"), 10),
    weekday: wd[get("weekday")] ?? 0,
    hour,
    minute: parseInt(get("minute"), 10),
  };
}

function isLastEtDayOfMonth(now: Date): boolean {
  return etParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)).day === 1;
}

const EXPIRE_DAYS = 183; // auto-void documents left unsigned this long

export async function runReminders(): Promise<number> {
  // Recycle Bin retention → auto-archive (protection for deleted docs): documents
  // soft-deleted > 90 days ago are NOT permanently destroyed. Instead they are
  // moved to the Archive (files + all rows preserved), so nothing is ever lost
  // automatically. Explicit permanent deletion is only via the manual "purge"
  // action (DELETE /:id/purge).
  const autoArchived = await pool.query(
    `update envelope
       set archived = true, archived_at = now(), deleted = false, deleted_at = null
     where deleted = true and deleted_at is not null and deleted_at < now() - ($1 || ' days')::interval
     returning id, title`,
    [RECYCLE_DAYS],
  );
  for (const row of autoArchived.rows) {
    await pool.query(
      `insert into activity (actor, action, detail, envelope_id) values ('system', 'Auto-archived from Recycle Bin', $1, $2)`,
      [row.title, row.id],
    );
  }

  // Auto-void (expire) documents that have been out for signature too long.
  const expired = await pool.query(
    `update envelope set status = 'expired'
     where status in ('sent', 'partially_completed') and archived = false and deleted = false
       and sent_at is not null and sent_at < now() - ($1 || ' days')::interval
     returning id, title`,
    [EXPIRE_DAYS],
  );
  for (const row of expired.rows) {
    await pool.query(
      `insert into event (envelope_id, actor, type, detail) values ($1, 'system', 'expired', $2)`,
      [row.id, `Auto-voided after ${EXPIRE_DAYS} days unsigned`],
    );
    // Awaited (not fire-and-forget) since this runner exits right after.
    await pool.query(
      `insert into activity (actor, action, detail, envelope_id) values ('system', 'Expired document', $1, $2)`,
      [row.title, row.id],
    );
  }

  const { rows } = await pool.query(
    `select id, title, reminder_interval, reminder_time, reminder_dow, reminder_dom,
            last_reminded_at, sent_at, created_at
     from envelope
     where status in ('sent', 'partially_completed') and reminder_interval is not null and archived = false and deleted = false`,
  );
  const now = new Date();
  const et = etParts(now);
  const nowMin = et.hour * 60 + et.minute;
  let sent = 0;

  for (const env of rows) {
    const [th, tm] = String(env.reminder_time ?? "09:00")
      .split(":")
      .map((s: string) => parseInt(s, 10));
    const schedMin = (isNaN(th) ? 9 : th) * 60 + (isNaN(tm) ? 0 : tm);

    let dayMatch = false;
    if (env.reminder_interval === "daily") dayMatch = true;
    else if (env.reminder_interval === "weekly") dayMatch = et.weekday === Number(env.reminder_dow);
    else if (env.reminder_interval === "monthly") {
      const dom = Number(env.reminder_dom);
      dayMatch = et.day === dom || (dom > 28 && dom > et.day && isLastEtDayOfMonth(now));
    }
    if (!dayMatch) continue;
    if (nowMin < schedMin) continue; // scheduled time hasn't arrived yet today
    // Never send the FIRST reminder within 24h of the document being sent.
    const sentAt = env.sent_at ?? env.created_at;
    if (
      !env.last_reminded_at &&
      sentAt &&
      now.getTime() - new Date(sentAt).getTime() < 24 * 60 * 60 * 1000
    ) {
      continue;
    }
    if (env.last_reminded_at && etParts(new Date(env.last_reminded_at)).dateKey === et.dateKey) {
      continue; // already reminded today
    }

    // Only remind recipients whose turn it actually is: status 'sent'. In
    // sequential mode the not-yet-their-turn signer sits at 'pending' (holding a
    // token but not yet active), so this skips them and reminds only the next
    // signer. In parallel mode every unsigned recipient is 'sent', so all still
    // get reminded. ('signed'/'declined' are excluded either way.)
    const recs = await pool.query(
      `select id, name, email, sign_token from recipient where envelope_id = $1 and status = 'sent'`,
      [env.id],
    );
    for (const r of recs.rows) {
      if (!r.sign_token) continue;
      const res = await sendPendingReminder({
        to: r.email,
        recipientName: r.name,
        title: env.title,
        url: `${config.publicBaseUrl}/sign/${r.sign_token}`,
        envelopeId: env.id,
        recipientId: r.id,
      });
      if (res.success) sent++;
    }
    await pool.query(`update envelope set last_reminded_at = now() where id = $1`, [env.id]);
  }
  sent += await runContractExpiryReminders(et);
  return sent;
}

// Contract Expiration Reminder: once the ET date reaches (expiration − N weeks),
// from 8:00 AM ET, email the Axus team inbox (info@) ONCE per setting. Covers
// any status and archived docs (contracts expire after they're archived), not
// Recycle Bin ones. A reminder set late (date already inside the window) goes
// out on the next run, as long as the contract hasn't expired yet.
async function runContractExpiryReminders(et: ReturnType<typeof etParts>): Promise<number> {
  if (et.hour < 8) return 0;
  const to = config.mail.notifyTo;
  if (!to) return 0;
  const due = await pool.query(
    `select id, title, company, doc_type, contract_reminder_weeks as weeks,
            to_char(contract_expires_on, 'FMMonth FMDD, YYYY') as expires_on
     from envelope
     where deleted = false and contract_reminder_sent_at is null
       and contract_expires_on is not null and contract_reminder_weeks is not null
       and $1::date >= contract_expires_on - (contract_reminder_weeks * 7)
       and $1::date <= contract_expires_on`,
    [et.dateKey],
  );
  let sent = 0;
  for (const e of due.rows) {
    const res = await sendContractExpiryReminder({
      to,
      title: e.title,
      company: e.company,
      docType: e.doc_type,
      expiresOn: e.expires_on,
      weeks: Number(e.weeks),
      url: `${config.publicBaseUrl}/envelopes/${e.id}`,
      envelopeId: e.id,
    });
    if (!res.success) continue; // retried on the next run
    sent++;
    await pool.query(`update envelope set contract_reminder_sent_at = now() where id = $1`, [e.id]);
    await pool.query(
      `insert into event (envelope_id, actor, type, detail) values ($1, 'system', 'expiration_reminder', $2)`,
      [e.id, `Contract expiration reminder emailed to ${to} (expires ${e.expires_on})`],
    );
    await pool.query(
      `insert into activity (actor, action, detail, envelope_id) values ('system', 'Contract expiration reminder sent', $1, $2)`,
      [e.title, e.id],
    );
  }
  return sent;
}

runReminders()
  .then((n) => {
    console.log(`reminders sent: ${n}`);
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("reminder run failed:", e);
    process.exit(1);
  });

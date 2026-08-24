// Standalone reminder runner — invoked every 15 min by cron:
//   docker compose exec -T aesign node dist/reminders.js
// Emails signers who haven't completed a sent/partially-completed document, on
// the schedule set per document (daily @time, weekly @dow+time, monthly @dom+time)
// interpreted in Eastern Time. Fires once per scheduled day, after the time.
import { pool } from "./db.js";
import { config } from "./config.js";
import { sendPendingReminder } from "./mail.js";

const TZ = "America/New_York";

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
  // Auto-void (expire) documents that have been out for signature too long.
  const expired = await pool.query(
    `update envelope set status = 'expired'
     where status in ('sent', 'partially_completed') and archived = false
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
     where status in ('sent', 'partially_completed') and reminder_interval is not null and archived = false`,
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

    const recs = await pool.query(
      `select name, email, sign_token from recipient where envelope_id = $1 and status <> 'signed'`,
      [env.id],
    );
    for (const r of recs.rows) {
      if (!r.sign_token) continue;
      const ok = await sendPendingReminder({
        to: r.email,
        recipientName: r.name,
        title: env.title,
        url: `${config.publicBaseUrl}/sign/${r.sign_token}`,
      });
      if (ok) sent++;
    }
    await pool.query(`update envelope set last_reminded_at = now() where id = $1`, [env.id]);
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

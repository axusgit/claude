// Standalone reminder runner — invoked every 15 min by cron:
//   docker compose exec -T legal node dist/reminders.js
// Emails signers who haven't completed a sent/partially-completed document, on
// the schedule set per document (daily @time, weekly @dow+time, monthly @dom+time)
// interpreted in Eastern Time. Fires once per scheduled day, after the time.
import { pool } from "./db.js";
import { config } from "./config.js";
import { sendPendingReminder } from "./mail.js";
const TZ = "America/New_York";
function etParts(d) {
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
    const get = (t) => p.find((x) => x.type === t)?.value ?? "";
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hour = parseInt(get("hour"), 10);
    if (hour === 24)
        hour = 0;
    return {
        dateKey: `${get("year")}-${get("month")}-${get("day")}`,
        day: parseInt(get("day"), 10),
        weekday: wd[get("weekday")] ?? 0,
        hour,
        minute: parseInt(get("minute"), 10),
    };
}
function isLastEtDayOfMonth(now) {
    return etParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)).day === 1;
}
export async function runReminders() {
    const { rows } = await pool.query(`select id, title, reminder_interval, reminder_time, reminder_dow, reminder_dom, last_reminded_at
     from envelope
     where status in ('sent', 'partially_completed') and reminder_interval is not null`);
    const now = new Date();
    const et = etParts(now);
    const nowMin = et.hour * 60 + et.minute;
    let sent = 0;
    for (const env of rows) {
        const [th, tm] = String(env.reminder_time ?? "09:00")
            .split(":")
            .map((s) => parseInt(s, 10));
        const schedMin = (isNaN(th) ? 9 : th) * 60 + (isNaN(tm) ? 0 : tm);
        let dayMatch = false;
        if (env.reminder_interval === "daily")
            dayMatch = true;
        else if (env.reminder_interval === "weekly")
            dayMatch = et.weekday === Number(env.reminder_dow);
        else if (env.reminder_interval === "monthly") {
            const dom = Number(env.reminder_dom);
            dayMatch = et.day === dom || (dom > 28 && dom > et.day && isLastEtDayOfMonth(now));
        }
        if (!dayMatch)
            continue;
        if (nowMin < schedMin)
            continue; // scheduled time hasn't arrived yet today
        if (env.last_reminded_at && etParts(new Date(env.last_reminded_at)).dateKey === et.dateKey) {
            continue; // already reminded today
        }
        const recs = await pool.query(`select name, email, sign_token from recipient where envelope_id = $1 and status <> 'signed'`, [env.id]);
        for (const r of recs.rows) {
            if (!r.sign_token)
                continue;
            const ok = await sendPendingReminder({
                to: r.email,
                recipientName: r.name,
                title: env.title,
                url: `${config.publicBaseUrl}/sign/${r.sign_token}`,
            });
            if (ok)
                sent++;
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
//# sourceMappingURL=reminders.js.map
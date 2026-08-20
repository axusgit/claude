// Standalone reminder runner — invoked by a daily cron:
//   docker compose exec -T legal node dist/reminders.js
// For each SENT envelope with a reminder interval, if a reminder is due it
// emails every signer who hasn't completed yet, then stamps last_reminded_at.
import { pool } from "./db.js";
import { config } from "./config.js";
import { sendPendingReminder } from "./mail.js";
const INTERVAL_MS = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
};
export async function runReminders() {
    const { rows } = await pool.query(`select id, title, reminder_interval, sent_at, last_reminded_at
     from envelope
     where status = 'sent' and reminder_interval is not null`);
    const now = Date.now();
    let sent = 0;
    for (const env of rows) {
        const iv = INTERVAL_MS[env.reminder_interval];
        if (!iv)
            continue;
        const base = env.last_reminded_at ?? env.sent_at;
        if (!base)
            continue;
        if (now - new Date(base).getTime() < iv)
            continue;
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
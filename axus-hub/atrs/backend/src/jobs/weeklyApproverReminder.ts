// One-shot job: email the approver everything awaiting approval, once a week,
// after the Sun–Sat work week closes (submissions are due Sat 23:59 ET).
//
// Run by a host cron on the hub box (America/New_York):
//   0 8 * * 0  docker exec axus-atrs-1 node dist/jobs/weeklyApproverReminder.js
// Safe to run by hand any time — it only sends when something is pending.
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendWeeklyApproverReminder } from "../mail.js";

const TZ = "America/New_York";

// Current date (YYYY-MM-DD) and day-of-week (0=Sun..6=Sat) in Eastern time.
function etTodayDow(now: Date): { ymd: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ymd, dow: dowMap[get("weekday")] };
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// "Nov 2 – Nov 8, 2026" for the Sun–Sat range.
function weekLabel(startYmd: string, endYmd: string): string {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const md = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const mdy = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  return `${md.format(d(startYmd))} – ${mdy.format(d(endYmd))}`;
}

async function main(): Promise<number> {
  // The work week is Sunday 00:00 → Saturday 23:59 ET. The reminder fires at the
  // start of the new week and covers the week that just closed.
  const { ymd, dow } = etTodayDow(new Date());
  const currentWeekStart = addDays(ymd, -dow); // this week's Sunday
  const reportStart = addDays(currentWeekStart, -7); // closed week's Sunday
  const reportEnd = addDays(currentWeekStart, -1); // closed week's Saturday
  const label = weekLabel(reportStart, reportEnd);

  // Everything still awaiting approval (submitted, undecided) — grouped by
  // contractor. Covers the just-closed week and any earlier stragglers so
  // nothing lingers unapproved.
  const rows = (
    await pool.query<{ worker_email: string; worker_name: string | null; n: number; hours: number }>(
      `select e.worker_email, w.name as worker_name,
              count(*)::int as n, coalesce(sum(e.hours),0)::float8 as hours
       from time_entry e left join worker w on w.email = e.worker_email
       where e.status = 'submitted'
       group by e.worker_email, w.name
       order by w.name nulls last`,
    )
  ).rows;

  if (!rows.length) {
    console.log(`[atrs weekly-reminder] week ${label}: nothing pending — no email sent.`);
    return 0;
  }

  const perWorker = rows.map((r) => ({
    name: r.worker_name ?? r.worker_email,
    count: r.n,
    hours: Math.round(r.hours * 100) / 100,
  }));
  const totalCount = perWorker.reduce((s, w) => s + w.count, 0);
  const totalHours = Math.round(perWorker.reduce((s, w) => s + w.hours, 0) * 100) / 100;

  const res = await sendWeeklyApproverReminder({
    to: config.mail.approverTo,
    weekLabel: label,
    totalCount,
    totalHours,
    perWorker,
    url: `${config.publicBaseUrl}/`,
  });

  if (res.success) {
    console.log(`[atrs weekly-reminder] week ${label}: reminded ${config.mail.approverTo} — ${totalCount} entr${totalCount === 1 ? "y" : "ies"}, ${totalHours} h.`);
    return 0;
  }
  console.error(`[atrs weekly-reminder] week ${label}: send FAILED — ${res.error}`);
  return 1;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((e) => {
    console.error("[atrs weekly-reminder] error:", e);
    void pool.end().finally(() => process.exit(1));
  });

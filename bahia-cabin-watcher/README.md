# Bahia Honda Cabin Watcher

Watches cabin availability at **Bahia Honda State Park** and notifies you the
instant a bookable opening appears. Talks directly to the Florida State Parks
(UseDirect) reservation API — no browser/scraping.

## What it watches

- **Park:** Bahia Honda State Park (`PlaceId 4`)
- **Cabins:** facility `12` ("Loop BAYC") — the 6 duplex cabin units (Cabin #001–#006)
- **Rule:** 2-night minimum. It scans the next `MONTHS_AHEAD` months and reports
  any cabin with a run of consecutive free nights ≥ the minimum.
- Alerts **only once per newly-freed night** (dedup is tracked per cabin-night in
  `state.json`), and only after a notification actually sends (a failed send is
  retried next run — never silently dropped). A window shrinking never re-alerts;
  a night that reopens after being booked does. So no repeat pings for the same
  availability.

## How it runs (production)

Deployed on **axus-server01** (`98.88.111.130`) at `~/bahia-cabin-watcher`,
via cron **every 30 seconds**. Cron's floor is 1 minute, so two entries give the
30s cadence; `flock` prevents overlapping runs if one ever runs long:

```
* * * * * flock -n /tmp/bahia-watcher.lock /usr/bin/node /home/ubuntu/bahia-cabin-watcher/watcher.js >> /home/ubuntu/bahia-cabin-watcher/watcher.log 2>&1
* * * * * sleep 30; flock -n /tmp/bahia-watcher.lock /usr/bin/node /home/ubuntu/bahia-cabin-watcher/watcher.js >> /home/ubuntu/bahia-cabin-watcher/watcher.log 2>&1
```

Requests have a 20s timeout (`HTTP_TIMEOUT_MS`) so a hung call can't stall a run.
Logs: `~/bahia-cabin-watcher/watcher.log` (quiet by default — only logs when
cabins are available or on error).

## Notifications

Configured in `.env`. Any channel you fill in fires; the rest are skipped.

1. **ntfy push (active):** install the free **ntfy** app (iOS/Android), then
   subscribe to the private topic in `.env` (`NTFY_TOPIC`). Urgent priority with
   a tap-to-book link. Zero account needed.
2. **Email:** set `SMTP_*` + `EMAIL_TO`.
3. **SMS (Twilio):** set `TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM` / `SMS_TO`.

## Control panel (GUI)

Easiest way to change what it watches — no editing files by hand:

```bash
npm run gui       # or double-click gui.bat
```

Opens a form at `http://127.0.0.1:8787` to set minimum nights, how far ahead to
scan, earliest check-in, an optional specific date window, and weekends-only.

- **Save & deploy** writes `config.json` to the box over your `axus-server01`
  SSH alias; the next cron run (≤30s) uses it — no restart needed.
- **Check availability now** previews live openings without sending any alert.

`config.json` (search parameters) overrides the `.env` defaults; secrets stay in
`.env` only.

## Config knobs

| Key | Meaning | Default |
|-----|---------|---------|
| `MIN_NIGHTS` | Minimum consecutive nights to count as an opening | `2` |
| `MONTHS_AHEAD` | How far ahead to scan | `6` |
| `START_OFFSET_DAYS` | Earliest check-in = today + N days | `0` |
| `WATCH_START` / `WATCH_END` | Restrict to a specific stay window (ISO dates) | blank = any |
| `WEEKENDS_ONLY` | Only alert on stays including a Fri/Sat night | `false` |
| `QUIET` | Suppress the "nothing available" log line | `true` |

To watch a **specific trip** instead of any opening, set `WATCH_START` /
`WATCH_END` (and optionally raise `MIN_NIGHTS`).

## Run manually

```bash
cd ~/bahia-cabin-watcher
node watcher.js          # one check now
```

## Operate

```bash
tail -f ~/bahia-cabin-watcher/watcher.log     # watch activity
crontab -l | grep bahia                        # confirm schedule
rm ~/bahia-cabin-watcher/state.json            # force re-alert of current openings
```

## Notes

- Other Bahia Honda facilities (if you ever want them): `13` Loop BAYS (tents),
  `14` Loop BTWC (RV/tent), `15` Loop SSC (RV/tent). Cabins are `12`.
- API base: `https://floridardr.usedirect.com/Floridardr/rdr/` (endpoint
  `search/grid`). Same UseDirect platform as several other states, so this
  approach ports to other Florida parks by changing `PLACE_ID` / `FACILITY_ID`.

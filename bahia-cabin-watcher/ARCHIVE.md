# Bahia Honda Cabin Watcher — ARCHIVE / HANDOFF

**Status: DECOMMISSIONED & ARCHIVED 2026-09-09.** The July 2027 cabin was successfully
held; this was the last planned reservation. The production system on `axus-srv01`
(all crons + the remote directory) was removed, and the iPhone ntfy subscription was
cancelled. This local copy is the sole archive, preserved in case it's ever revived
(possibly years out).

This file is the durable brain-dump of everything reverse-engineered while building the
tool, so a future you (or a future Claude) can pick it up cold without re-deriving it.
The `README.md` covers normal operation; **this file covers the hard-won internals.**

---

## ⚠️ REVIVE CHECKLIST — verify these FIRST (they will drift over years)

Before trusting any code below, confirm each of these is still true. In a multi-year gap,
any of them can change and silently break everything:

1. **API still live & shape unchanged.** Base `https://floridardr.usedirect.com/Floridardr/rdr/`.
   - `POST search/grid` (returns 21-day availability pages, applies real booking rules).
   - `GET fd/availability/getbyunit/<unitId>/startdate/<iso>/nights/N/false` (raw per-slice inventory).
   - UseDirect is a shared platform (many US state parks); Florida may migrate off it.
2. **Park / facility IDs unchanged.** Bahia Honda = `PlaceId 4`; the 6 cabins = facility `12`
   ("Loop BAYC"). Other facilities: 13 BAYS (tents), 14 BTWC (RV/tent), 15 SSC (RV/tent).
3. **Cabin unit IDs unchanged.** #001=177, #002=173, #003=174, #004=175, #005=176, #006=172.
   (Verify with a near-term grid call before relying — these are only used as labels now,
   detection is facility-12-wide.)
4. **Release cadence still 8:00 PM ET.** The new furthest-arrival day (today + 11 calendar
   months, America/New_York) releases nightly at 8 PM ET. Peak dates are gone within seconds.
   (This was re-verified repeatedly; 8 AM was a red herring. See "Release mechanic" below.)
5. **Booking window still ~11 months.** Furthest bookable arrival = today + 11 calendar months.
6. **Booking deep-link format unchanged:** `https://reserve.floridastateparks.org/Web/#!park/4/12`
   → positional `#!park/<placeId>/<facilityId>`, NO literal "facility/" segment (that 404s).
   No date param exists in the URL (arrival lives in SPA state).
7. **Login still reCAPTCHA-gated** (`/LoginByEmail_V2`, `grecaptcha.getResponse()`). A human
   must solve it; no stored-credential auto-login is possible.
8. **Node runtime.** Built/run on Node 22 (`/usr/bin/node` on the box). Reinstall deps with
   `npm install` (root) and `cd sniper && npm install` — `node_modules/` were stripped from
   the archive. Playwright (sniper) will re-download Chromium on install.
9. **Regenerate all secrets** (see "Secrets" — none are in this archive).

---

## What it is

Personal availability watcher for the **6 duplex cabins (Cabin #001–#006) at Bahia Honda
State Park**, FL Keys. Talks directly to the Florida State Parks (UseDirect) reservation
JSON API — no scraping. Detects a bookable 2-night (park minimum) stay and pushes an alert
so you can go book it. Built 2026-08-11.

Two generations of the tool exist in this repo:
- **`watcher.js`** — the original polling watcher (search/grid). Retired from production
  2026-08-26, kept as a fallback.
- **`sniper/sniper.js`** — the evolved system that actually ran in production until
  decommission. Faster, range-filtered, with a nightly release-burst mode. **This is the
  one to revive.**

---

## Key facts (quick reference)

| Thing | Value |
|---|---|
| Park | Bahia Honda State Park — `PlaceId 4` |
| Cabins facility | `12` ("Loop BAYC"), units Cabin #001–#006 |
| Cabin unit IDs | #001=177, #002=173, #003=174, #004=175, #005=176, #006=172 |
| API base | `https://floridardr.usedirect.com/Floridardr/rdr/` |
| Availability (rules-applied) | `POST search/grid` (Nights:2; 21-day pages) |
| Availability (raw inventory) | `GET fd/availability/getbyunit/<unitId>/startdate/<iso>/nights/N/false` |
| Booking window | today + 11 calendar months (arrival edge advances daily) |
| Release time | **8:00 PM ET** nightly (new furthest-arrival day) |
| Min stay | 2 nights (park-enforced) |
| Booking deep-link | `https://reserve.floridastateparks.org/Web/#!park/4/12` |
| Login | `/LoginByEmail_V2`, reCAPTCHA v2 — human-only |
| ntfy topic (decommissioned) | `bahia-cabins-c82a23c78bea` (regenerate a fresh one if revived) |
| Andy's target trip | arrivals Jun 5 – Aug 5, 2027 (the trip this tool was built for) |

---

## Detection rule (FINAL — supersedes several earlier flip-flops)

A 2-night stay starting on date `D` is **genuinely bookable** iff:

- **`POST search/grid` (Nights:2)** reports the slice `IsFree=true` for arrival `D`, AND
- the stay's **last night (`D+1`) ≤ furthest-arrival** (today + 11 calendar months).

Critical lessons that produced this rule:
- **`search/grid` is authoritative for bookability**, because it applies the real booking
  rules. Use it for alerts.
- **`getbyunit` shows RAW inventory and OVER-reports the 11-month edge.** Those edge dates
  are "add-on only" (stranded: the prior night is booked and the next night hasn't released
  yet) — inventory exists but they are NOT standalone-bookable as a new arrival. Using
  getbyunit for alerts caused **false alerts** Andy couldn't act on.
- **`search/grid` can also serve PHANTOM "free"** from stale load-balanced backend nodes
  (once observed 22 "free" that were all actually booked). If in doubt, cross-check a hit
  against the live booking UI before alerting.
- A specific arrival `D` only becomes grid-bookable once `D+1` also releases (at the next
  8 PM ET) — which is why the nightly `--arm` burst targets exactly the single
  today+11-months day.

Dedup: per-cabin-night in `sniper/sniper-state.json` (and `state.json` for watcher.js),
STICKY with a reopen cooldown (`REOPEN_GAP_MS`, default 6h) so cart-hold/API blips don't
re-alert; a real book-then-cancel does. Failed sends retry next run (never silently dropped).

---

## Release mechanic (why 8 PM ET)

- The park releases one new furthest-arrival day per night. The day that becomes **startable**
  at 8 PM ET = **ET-today + 11 calendar months** (its 2nd night releases that night).
- Inventory for a day appears ~1 day before it's startable (add-on until its 2nd night releases).
- **Peak dates vanish in seconds/ms** to bots at 8 PM — verified live 2026-08-27: 2027-07-27
  opened at 8 PM and all 6 cabins were booked within ~4 minutes, faster than a 125 ms poll and
  far faster than any human. **Alert-then-click cannot win a contested peak release.** It CAN
  win lingering openings: **cancellations** (random times, not bot-camped) and off-peak dates.
  That's the realistic game — range-filtered cancellation alerts over months.
- `--arm` cron was set for 7:58 PM ET via two UTC entries (`58 23` EDT + `58 0` EST); DST
  self-corrects (the wrong-season run exits immediately). An 8 AM variant was also trialed to
  disprove the 8-AM theory — 8 PM is correct.

---

## Auto-hold click-path (PROVEN, but never won a real peak release)

An auto-hold ("bot adds the cabin to cart/hold, then you finish payment — no stored payment,
no auto-charge") was built and a **real test hold was successfully placed & released**
(Tent #075, facility 13, 2026-08-31, 1 night) to prove the flow. Files: `sniper/autohold.js`
(+ `ah-build.js`, `ah-test.js`); screenshots `sniper/*.png` document the UI.

**Proven flow (React SPA, driven over Chrome DevTools Protocol / CDP port 9222):**
1. Set dates via `#search-header-datepicker` — click arrival then departure
   `react-datepicker__day` cells by `aria-label` "Choose \<Weekday\>, \<Month\> \<D\>, \<Y\>".
2. Click the unit's arrival cell — a `<button aria-label="Cabin #00X MM/DD/YYYY - available">`
   — which selects it and opens a detail panel with a **"Book Now"** button (disabled unless
   the full stay is available).
3. Click **"Book Now"** → navigates to `SelectReservationPreCart.aspx` ("Reservation Details")
   = the hold is placed. Navigating back to the facility URL abandons/releases the hold.

**Honest speed caveat:** the grid must be refreshed (`setDate` re-query ~3.5 s) before the
cell renders, so a hold attempt is ~5–8 s end-to-end → **loses to sub-second bots on contested
peak releases, wins lingering openings.** High value for the cancellation game, not the 8 PM
peak scramble.

**Constraints if revived:** must run HEADED on your PC (the box is headless; the booking web
host WAF blocks headless + hammering). Requires `sniper/live-browser.js` open and logged in
(session cookies are session-only — they die on browser close, so re-login each session), and
your PC must be awake. The booking flow is stateful ASP.NET WebForms (VIEWSTATE/session,
`.aspx`/`.asmx`) — there is no clean JSON hold API.

---

## Notifications / channels (all fire on any in-range opening)

Configured in `.env` (see `.env.example`). Any channel filled in fires; the rest are skipped.
1. **ntfy push (primary):** private topic (`NTFY_TOPIC`), install the free ntfy app and
   subscribe. Zero account. Urgent priority + tap-to-book deep-link.
2. **Email:** M365 relay — `smtp.office365.com:587`, auth `support@axustechnologies.com`,
   `EMAIL_FROM=no-reply@axustechnologies.com` (M365 accepted the send-as). Same relay
   ProAITrader uses.
3. **Text (free):** carrier email-to-SMS gateway. Andy's number is on Boost, which rides
   T-Mobile's network, so `<10digits>@tmomail.net` delivers (Boost's own gateway did NOT).
4. **Twilio SMS:** supported in code but deliberately unused — the Axus Twilio account has no
   A2P 10DLC approval, so US texts get carrier-filtered (err 30034).

---

## Secrets — NONE are in this archive; regenerate on revive

The real `.env`, the Playwright login session (`sniper/auth.json`), the logged-in browser
profile (`sniper/browser-profile/`), and the login network capture
(`sniper/network-capture.jsonl`) were **stripped from this archive** — they're credential-
equivalent. To revive:
- Copy `.env.example` → `.env` and fill in.
- **ntfy:** invent a fresh unguessable topic (e.g. `bahia-cabins-<random-hex>`), subscribe on
  your phone. The old topic `bahia-cabins-c82a23c78bea` was public-by-obscurity; don't reuse.
- **Email/SMS:** the M365 SMTP password was shared with ProAITrader (`/opt/axus-trade/.env` on
  `axus-srv01`). Pull the current value from there (it may have rotated). This credential was
  NOT changed at decommission — nothing to rotate now on account of this tool.
- **Auto-hold login:** re-run `sniper/login-setup.js` on your PC and solve the captcha once to
  regenerate the session.

---

## How to run / redeploy

Local (from this folder):
```bash
npm install                 # root deps (node-fetch/nodemailer etc.)
cd sniper && npm install    # sniper deps incl. Playwright (re-downloads Chromium)

node watcher.js --json      # gen-1: print current openings + config, no notify
node sniper/sniper.js --once   # gen-2: print bookable-now (0 when board is full = correct)
node sniper/sniper.js --tick   # one scan + alert-on-new (cron-friendly, dedup)
node sniper/sniper.js --arm    # 8 PM release burst (targets today+11mo single day)
npm run gui                 # local control panel at http://127.0.0.1:8787
```

Production (was on `axus-srv01`, ssh alias `axus-srv01`/`sra`, `~/bahia-cabin-watcher`):
- Two `--tick` cron lines (one + one `sleep 30;`) gave a 30 s cadence, `flock` prevents overlap.
- Four `--arm` lines gave 7:58 PM + 7:58 AM bursts in both EDT and EST.
- `monitor-time.js` `*/5` logged newest-reservation-start to pin release timing.
- Full crontab snapshot from decommission day is in `~/crontab-backup-20260909-132431.txt`
  on the box (if that box still exists).

---

## Hard-won gotchas

- **WAF / rate-limit:** `floridardr.usedirect.com` fronts a WAF that 403s on request bursts.
  grid returns only 21 days/call, so an 11-month scan ≈ 16 calls; at 30 s polling that flagged
  the box IP. Fix = **uniform rotating scan** (a few pages/run rotating evenly across the whole
  window via `state.farCursor`), ~800 ms page spacing, browser-like headers, and patient
  exponential backoff (5 tries, 1→5 s) on 403/429/5xx.
- **Web host WAF is harsher:** `reserve.floridastateparks.org` (the booking site, not the API)
  TLS-RESETs an IP that probes/hammers it, and blocks headless. So: keep the 100 ms speed on the
  **API/detection** side only; the **grab** must be a single-shot HEADED human-paced action.
- **Cross-IP session caveat:** a login session captured on your home IP may be rejected from the
  box's IP — run the auto-hold on your PC, or verify the cookie works cross-IP first.
- **`.env` parser** strips inline `# comments` and ASCII-sanitizes HTTP header values (a raw
  non-ASCII header value once broke sends). Keep comments on their own lines.

---

## File map (what's in this archive)

Root:
- `watcher.js` — gen-1 watcher (search/grid, rotating scan, dedup). Retired, kept as fallback.
- `gui.js` / `gui.bat` — local control panel (no-dep Node server, 127.0.0.1:8787).
- `release-probe.js` — read-only probe used to pin the release time/mechanic.
- `test-dedup.js` — 14 tests over the dedup/reconcile logic.
- `README.md` — normal-operation docs. `ARCHIVE.md` — this file.
- `.env.example`, `config.example.json` — templates. `config.json` — last search params.
- `package.json` / `package-lock.json`.

`sniper/` (the production system):
- `sniper.js` — the live detector/alerter. Modes: `--once`, `--tick`, `--hunt`, `--arm`,
  `--seed`, `--testalert`. Config in `sniper.config.json` (watchStart/End, intervalMs, windows).
- `autohold.js` — proven auto-hold (CDP-driven "Book Now" click-path). Needs headed login.
- `ah-build.js`, `ah-test.js` — auto-hold build/test helpers.
- `live-browser.js` — launches a persistent logged-in Chrome exposing CDP on :9222.
- `login-setup.js` — headed login + captcha solve, persists the session.
- `driver.js`, `explore.js`, `watch-unlock.js`, `monitor-time.js` — investigation/monitoring tools.
- `send-alert.js` — shared 3-channel alert sender.
- `*.png` — screenshots documenting the booking UI / click-path.
- **Stripped from archive (regenerate):** `auth.json`, `browser-profile/`,
  `network-capture.jsonl`, `node_modules/`, and all runtime state/logs.

---

## State at decommission (2026-09-09)

- July 2027 cabin held (goal achieved). No future reservations planned.
- `axus-srv01`: all 7 bahia crons removed, remote `~/bahia-cabin-watcher` directory deleted,
  no processes. Unrelated crons (SRA, ProAITrader, axus-vm-watcher, heartbeat, copy-trading)
  untouched.
- iPhone: ntfy topic `bahia-cabins-c82a23c78bea` unsubscribed.
- This local copy (in the axus-claude monorepo) + a zipped snapshot in OneDrive are the archive.

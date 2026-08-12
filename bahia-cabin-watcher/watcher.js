#!/usr/bin/env node
/*
 * Bahia Honda cabin availability watcher.
 *
 * Polls the Florida State Parks (UseDirect) reservation API for the 6 cabins at
 * Bahia Honda State Park and notifies you the instant a bookable opening appears.
 *
 * Run once per invocation (designed for cron):  node watcher.js
 *
 * Config comes from environment variables (see .env.example). On start it loads
 * a sibling .env file if present.  No availability => silent.  New opening =>
 * fires every configured notification channel (ntfy push, email, SMS).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = tryRequire('nodemailer'); // optional; only needed for email

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
loadDotenv(path.join(__dirname, '.env'));

const CFG = {
  apiBase: env('API_BASE', 'https://floridardr.usedirect.com/Floridardr/rdr/'),
  placeId: intEnv('PLACE_ID', 4),          // Bahia Honda State Park
  facilityId: intEnv('FACILITY_ID', 12),   // "Loop BAYC" = the 6 cabins
  parkName: env('PARK_NAME', 'Bahia Honda'),
  facilityName: env('FACILITY_NAME', 'Cabins'),

  minNights: intEnv('MIN_NIGHTS', 2),      // cabins enforce a 2-night minimum
  startOffsetDays: intEnv('START_OFFSET_DAYS', 0), // earliest check-in from today
  monthsAhead: intEnv('MONTHS_AHEAD', 6),  // how far out to scan
  // Optional hard window (ISO YYYY-MM-DD). If set, only alert on stays whose
  // check-in falls on/after WATCH_START and check-out on/before WATCH_END.
  watchStart: env('WATCH_START', ''),
  watchEnd: env('WATCH_END', ''),
  // Optional: only alert on stays that include a Friday or Saturday night.
  weekendsOnly: boolEnv('WEEKENDS_ONLY', false),

  stateFile: env('STATE_FILE', path.join(__dirname, 'state.json')),
  userAgent: env('USER_AGENT', 'bahia-cabin-watcher/1.0 (personal availability alert)'),
  httpTimeoutMs: intEnv('HTTP_TIMEOUT_MS', 20000), // abort any request that hangs
  // Once alerted about a cabin-night, don't alert again for it unless it has been
  // genuinely gone this long and then reopened (a real book-then-cancel). Shorter
  // disappearances are transient cart-holds/API blips and must NOT re-alert.
  reopenGapMs: intEnv('REOPEN_GAP_MS', 6 * 60 * 60 * 1000), // 6 hours
  pageDelayMs: intEnv('PAGE_DELAY_MS', 800), // pause between grid pages within a scan
  // Uniform coverage: each cron run fetches this many 21-day pages, rotating
  // evenly across the WHOLE window so every month is checked on the same
  // cadence. Higher = more frequent coverage but more requests (WAF risk).
  // With ~16 pages (11 months) and 4/run @30s, every date is re-checked ~every 2 min.
  pagesPerRun: intEnv('PAGES_PER_RUN', 4),
  quiet: boolEnv('QUIET', false),          // suppress the "nothing available" log line

  // channels
  ntfyServer: env('NTFY_SERVER', 'https://ntfy.sh'),
  ntfyTopic: env('NTFY_TOPIC', ''),
  ntfyToken: env('NTFY_TOKEN', ''),        // optional bearer token for private ntfy

  smtpHost: env('SMTP_HOST', ''),
  smtpPort: intEnv('SMTP_PORT', 587),
  smtpSecure: boolEnv('SMTP_SECURE', false),
  smtpUser: env('SMTP_USER', ''),
  smtpPass: env('SMTP_PASS', ''),
  emailFrom: env('EMAIL_FROM', ''),
  emailTo: env('EMAIL_TO', ''),
  // Carrier email-to-SMS gateway address(es), e.g. 7275551234@tmomail.net.
  // Gets a real text on your phone with no Twilio / A2P approval. Comma-separate.
  emailSmsTo: env('EMAIL_SMS_TO', ''),

  twilioSid: env('TWILIO_SID', ''),
  twilioToken: env('TWILIO_TOKEN', ''),
  twilioFrom: env('TWILIO_FROM', ''),
  smsTo: env('SMS_TO', ''),
};

// Search parameters can also come from config.json (written by the GUI). These
// override the .env defaults for the fields present. Secrets stay in .env only.
applyConfigJson(path.join(__dirname, 'config.json'));

function applyConfigJson(file) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  const map = {
    minNights: 'int', monthsAhead: 'int', startOffsetDays: 'int',
    watchStart: 'str', watchEnd: 'str', weekendsOnly: 'bool',
  };
  for (const [k, type] of Object.entries(map)) {
    if (cfg[k] == null || cfg[k] === '') { if (type === 'str' && cfg[k] === '') CFG[k] = ''; continue; }
    CFG[k] = type === 'int' ? parseInt(cfg[k], 10) : type === 'bool' ? !!cfg[k] : String(cfg[k]);
  }
}

// Their SPA routes are positional (:page/:park/:facility) — no literal "facility"
// segment — so the cabins deep-link is #!park/<placeId>/<facilityId>.
const BOOK_URL =
  `https://reserve.floridastateparks.org/Web/#!park/${CFG.placeId}/${CFG.facilityId}`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const JSON_OUT = process.argv.includes('--json');
const DRY = JSON_OUT || process.argv.includes('--dry') || boolEnv('DRY_RUN', false);
const TEST = process.argv.includes('--test');
const TEST_CHANNELS = (() => {
  const a = process.argv.find((x) => x.startsWith('--channels='));
  return a ? a.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
           : ['push', 'email', 'text'];
})();

async function main() {
  try {
    // --test: send a clearly-labeled TEST alert through the selected channels
    // (same code path as real alerts), print per-channel results as JSON, exit.
    if (TEST) { await runTest(TEST_CHANNELS); return; }

    const state = loadState();
    // Manual runs (--json/--dry) do a full scan; the high-frequency cron does a
    // near-term + rotating-far scan, advancing the rotation cursor each run.
    const { openings, nextFarCursor } = await scanOpenings({ full: DRY, farCursor: state.farCursor });

    // --json: print current openings + effective config, notify nothing. Used
    // by the GUI's "Check now". --dry: run everything but don't notify/persist.
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({
        checkedAt: nowIso(),
        config: {
          minNights: CFG.minNights, monthsAhead: CFG.monthsAhead,
          startOffsetDays: CFG.startOffsetDays, watchStart: CFG.watchStart,
          watchEnd: CFG.watchEnd, weekendsOnly: CFG.weekendsOnly,
        },
        openings,
      }));
      return;
    }

    const nowMs = Date.now();
    const todayIso = isoOf(startOfDay(new Date()));
    // Sticky per-night memory: seen = { "unitId|date": lastSeenFreeEpochMs }.
    const prevSeen = loadSeen(state, nowMs);

    const { fresh, buildSeen } = reconcile(openings, prevSeen, nowMs, CFG.reopenGapMs, todayIso);

    if (openings.length === 0) {
      if (!CFG.quiet) log('No cabin availability found.');
    } else {
      log(`${openings.length} open cabin window(s) found` +
          (fresh.length ? `, ${fresh.length} NEW.` : `, nothing new.`));
    }

    if (DRY) {
      log(`DRY RUN: would ${fresh.length ? 'notify about ' + fresh.length + ' opening(s)' : 'send nothing'}; state unchanged.`);
      return;
    }

    let alertedOk = false;
    if (fresh.length > 0) {
      alertedOk = await notifyAll(fresh);
    }

    // buildSeen refreshes timestamps for still-free nights, keeps freshly-alerted
    // ones (only if the send succeeded, else retry next run), and prunes past
    // dates. A night is NOT forgotten just because it vanished from one scan, so
    // transient flickers never re-alert.
    saveState({ seen: buildSeen(alertedOk), farCursor: nextFarCursor, updated: nowIso() });
  } catch (err) {
    log('ERROR: ' + (err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { reconcile, loadSeen };

// ---------------------------------------------------------------------------
// Availability scan
// ---------------------------------------------------------------------------
async function scanOpenings({ full = false, farCursor = 0 } = {}) {
  const today = new Date();
  const windowStart = addDays(startOfDay(today), CFG.startOffsetDays);
  const windowEnd = CFG.watchEnd
    ? parseIso(CFG.watchEnd)
    : addDays(startOfDay(today), CFG.monthsAhead * 30);
  const hardStart = CFG.watchStart ? parseIso(CFG.watchStart) : windowStart;
  const PAGE_DAYS = 21;
  const MAX_PAGES = 60; // safety cap (~3.4 years)

  // All 21-day page start dates covering the window.
  const allPages = [];
  for (let c = new Date(windowStart); c <= windowEnd && allPages.length < MAX_PAGES; c = addDays(c, PAGE_DAYS)) {
    allPages.push(new Date(c));
  }

  // full scan = every page (manual --json/--dry, low frequency). Otherwise fetch
  // a rotating window of pagesPerRun pages, advancing the cursor each run, so the
  // whole window is covered uniformly (every ceil(pages/pagesPerRun) runs) while
  // keeping the request rate under the reservation API's WAF limit.
  let pagesToFetch;
  let nextFarCursor = farCursor;
  if (full || allPages.length <= CFG.pagesPerRun) {
    pagesToFetch = allPages;
  } else {
    const n = allPages.length;
    const start = (((Number.isInteger(farCursor) ? farCursor : 0) % n) + n) % n;
    pagesToFetch = [];
    for (let j = 0; j < CFG.pagesPerRun; j++) pagesToFetch.push(allPages[(start + j) % n]);
    nextFarCursor = (start + CFG.pagesPerRun) % n;
  }

  const units = new Map(); // unitId -> { name, isAda, free:Set<isoDate>, minStay:Map }
  for (let i = 0; i < pagesToFetch.length; i++) {
    if (i > 0) await sleep(CFG.pageDelayMs); // spread requests so we're not bursty
    const grid = await fetchGrid(pagesToFetch[i]);
    const facUnits = (grid && grid.Facility && grid.Facility.Units) || {};
    for (const u of Object.values(facUnits)) {
      let rec = units.get(u.UnitId);
      if (!rec) {
        rec = { name: u.Name, isAda: !!u.IsAda, free: new Set(), minStay: new Map() };
        units.set(u.UnitId, rec);
      }
      for (const slice of Object.values(u.Slices || {})) {
        if (slice && slice.Date) {
          if (slice.IsFree) rec.free.add(slice.Date);
          if (slice.MinStay) rec.minStay.set(slice.Date, slice.MinStay);
        }
      }
    }
  }

  // Turn each unit's free-night set into consecutive runs, then into openings.
  const openings = [];
  for (const [unitId, rec] of units) {
    for (const run of consecutiveRuns([...rec.free])) {
      const nightsAvail = run.length;
      const minStay = Math.max(CFG.minNights, rec.minStay.get(run[0]) || CFG.minNights);
      if (nightsAvail < minStay) continue;

      const checkIn = run[0];
      const lastNight = run[run.length - 1];
      const checkOut = isoOf(addDays(parseIso(lastNight), 1));

      // Respect optional hard window.
      if (parseIso(checkIn) < startOfDay(hardStart)) continue;
      if (parseIso(checkOut) > addDays(startOfDay(windowEnd), 1)) continue;

      if (CFG.weekendsOnly && !runHasWeekend(run)) continue;

      openings.push({
        key: `${unitId}|${checkIn}|${checkOut}`,
        unitId,
        unit: rec.name,
        isAda: rec.isAda,
        checkIn,
        checkOut,
        nights: nightsAvail,
        nightDates: run, // the individual free-night ISO dates (for night-level dedup)
        minStay,
      });
    }
  }

  openings.sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
  return { openings, nextFarCursor };
}

async function fetchGrid(startDate) {
  const body = {
    FacilityId: CFG.facilityId,
    StartDate: mmddyyyy(startDate),
    Nights: CFG.minNights,
    UnitTypeId: 0,
    UnitCategoryId: 0,
    UnitTypesGroupIds: [],
    SleepingUnitId: 0,
    MinVehicleLength: 0,
    IsADA: false,
    WebOnly: true,
  };
  // Browser-like headers + a Referer from the real booking site reduce the odds
  // of the API's WAF rejecting us as a bot.
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Origin: 'https://reserve.floridastateparks.org',
    Referer: 'https://reserve.floridastateparks.org/',
  };
  // Retry transient WAF/rate-limit responses (403/429) and 5xx with growing
  // backoff, so a short block window clears within the retry budget instead of
  // aborting the whole scan. Backoff grows (1s,2s,4s,5s…) + jitter so we don't
  // hammer during a block.
  let lastErr;
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(5000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400));
    }
    let res;
    try {
      res = await fetchT(CFG.apiBase + 'search/grid', { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) { lastErr = e; continue; } // network error/timeout -> retry
    if (res.ok) return res.json();
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      lastErr = new Error(`grid HTTP ${res.status} for ${body.StartDate}`);
      continue; // transient -> retry
    }
    throw new Error(`grid HTTP ${res.status} for ${body.StartDate}`); // hard error
  }
  throw lastErr;
}

// [d1,d2,...] iso dates -> array of runs, each run an array of consecutive iso dates
function consecutiveRuns(dates) {
  const sorted = [...new Set(dates)].sort();
  const runs = [];
  let cur = [];
  for (const d of sorted) {
    if (cur.length === 0) {
      cur = [d];
    } else {
      const prev = cur[cur.length - 1];
      if (isoOf(addDays(parseIso(prev), 1)) === d) cur.push(d);
      else { runs.push(cur); cur = [d]; }
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function runHasWeekend(run) {
  // A "weekend night" is Fri or Sat check-in night.
  return run.some((d) => {
    const dow = parseIso(d).getDay(); // 0 Sun .. 6 Sat
    return dow === 5 || dow === 6;
  });
}

// Normalize prior state into { "unitId|date": lastSeenFreeMs }. Migrates the old
// array form (state.seenNights / state.seen as array) by stamping them as seen now.
function loadSeen(state, nowMs) {
  const s = state && state.seen;
  if (s && typeof s === 'object' && !Array.isArray(s)) return { ...s };
  const arr = Array.isArray(s) ? s : Array.isArray(state && state.seenNights) ? state.seenNights : [];
  const m = {};
  for (const k of arr) m[k] = nowMs;
  return m;
}

// Decide which openings are genuinely new, and produce the next seen-map.
// A cabin-night is "new" if we've never seen it, OR it was last seen free more
// than reopenGapMs ago (a real book-then-cancel, not a seconds-long flicker).
function reconcile(openings, prevSeen, nowMs, reopenGapMs, todayIso) {
  const keyOf = (o, d) => `${o.unitId}|${d}`;
  const isNew = (k) => {
    const last = prevSeen[k];
    return last == null || (nowMs - last) > reopenGapMs;
  };

  const freeKeys = []; // {k, d} for every currently-free night
  const fresh = [];
  for (const o of openings) {
    let anyNew = false;
    for (const d of o.nightDates) {
      const k = keyOf(o, d);
      freeKeys.push({ k, d });
      if (isNew(k)) anyNew = true;
    }
    if (anyNew) fresh.push(o);
  }

  const buildSeen = (alertedOk) => {
    const next = {};
    // carry forward remembered nights that haven't passed yet
    for (const [k, ts] of Object.entries(prevSeen)) {
      const d = k.split('|')[1];
      if (d && d >= todayIso) next[k] = ts;
    }
    // update currently-free nights
    for (const { k, d } of freeKeys) {
      if (d < todayIso) continue;
      const wasNew = next[k] == null || (nowMs - next[k]) > reopenGapMs;
      if (!wasNew) next[k] = nowMs;        // continuously free -> keep timestamp fresh
      else if (alertedOk) next[k] = nowMs; // we just alerted -> mark seen now
      // else: new but the alert failed -> leave as-is so it retries next run
    }
    return next;
  };

  return { fresh, buildSeen };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

// Send a labeled TEST alert to the requested channels; report per-channel result.
async function runTest(channels) {
  const want = new Set(channels);
  const link = BOOK_URL;
  const title = 'TEST - Bahia Honda cabin watcher';
  const textBody =
    'This is a TEST alert. If you received this, your alerts are working.\n\n' +
    'Real alerts fire the instant a cabin opens and include the cabin, dates, ' +
    'and this booking link:\n' + link;
  const htmlBody =
    '<h2>🏝️ TEST - Bahia Honda cabin watcher</h2>' +
    '<p>This is a <b>test alert</b>. If you got this, your alerts are working. ' +
    'Real alerts fire the instant a cabin opens and show the cabin, dates, and a ' +
    `<a href="${link}">booking link</a>.</p>`;
  const smsBody =
    'TEST: Bahia Honda cabin watcher alerts are working. Real alerts show the ' +
    'cabin, dates & link: ' + link;

  const results = {};
  const one = async (name, configured, fn) => {
    if (!want.has(name)) return;
    if (!configured) { results[name] = { ok: false, skipped: true, error: 'not configured' }; return; }
    try { await fn(); results[name] = { ok: true }; }
    catch (e) { results[name] = { ok: false, error: e.message }; }
  };

  await one('push', !!CFG.ntfyTopic, () => notifyNtfy(title, textBody));
  await one('email', !!(CFG.smtpHost && CFG.emailTo), () => notifyEmail(title, textBody, htmlBody));
  await one('text', !!(CFG.smtpHost && CFG.emailSmsTo), () => notifyEmailSms(smsBody));
  await one('sms', !!(CFG.twilioSid && CFG.smsTo), () => notifySms(smsBody));

  process.stdout.write(JSON.stringify({ test: true, channels, results }));
}

async function notifyAll(openings) {
  const { title, textBody, htmlBody, smsBody } = formatMessages(openings);

  const jobs = [];
  if (CFG.ntfyTopic) jobs.push(guard('ntfy', () => notifyNtfy(title, textBody)));
  if (CFG.smtpHost && CFG.emailTo) jobs.push(guard('email', () => notifyEmail(title, textBody, htmlBody)));
  if (CFG.smtpHost && CFG.emailSmsTo) jobs.push(guard('text-via-email', () => notifyEmailSms(smsBody)));
  if (CFG.twilioSid && CFG.smsTo) jobs.push(guard('sms', () => notifySms(smsBody)));

  if (jobs.length === 0) {
    log('WARNING: openings found but no notification channel is configured. ' +
        'Set NTFY_TOPIC / SMTP_* / TWILIO_* in .env.');
    log(textBody);
    return false;
  }
  const results = await Promise.all(jobs);
  return results.some(Boolean); // true if at least one channel delivered
}

// Run fn, retrying a couple times on transient failures (rate limits, blips).
async function withRetry(fn, attempts = 3, delayMs = 4000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// fetch with a hard timeout so a hung request can't stall a run (important at a
// 30s poll cadence where stalled runs would otherwise overlap).
async function fetchT(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), CFG.httpTimeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function formatMessages(openings) {
  const n = openings.length;
  const title = `🏝️ ${CFG.parkName} cabin${n > 1 ? 's' : ''} available! (${n} opening${n > 1 ? 's' : ''})`;

  const lines = openings.map((o) => {
    const nightsPart = `${o.nights} night${o.nights > 1 ? 's' : ''}`;
    const ada = o.isAda ? ' [ADA]' : '';
    return `• ${o.unit}${ada}: ${fmtDate(o.checkIn)} → ${fmtDate(o.checkOut)} (${nightsPart})`;
  });

  const textBody =
    `${n} bookable cabin opening${n > 1 ? 's' : ''} at ${CFG.parkName}:\n\n` +
    lines.join('\n') +
    `\n\nBook now: ${BOOK_URL}\n(min ${CFG.minNights}-night stay)`;

  const htmlBody =
    `<h2>${escapeHtml(title)}</h2>` +
    `<p>${n} bookable cabin opening${n > 1 ? 's' : ''} at <b>${escapeHtml(CFG.parkName)}</b>:</p>` +
    '<ul>' +
    openings
      .map((o) => `<li><b>${escapeHtml(o.unit)}</b>${o.isAda ? ' [ADA]' : ''}: ` +
        `${fmtDate(o.checkIn)} → ${fmtDate(o.checkOut)} (${o.nights} night${o.nights > 1 ? 's' : ''})</li>`)
      .join('') +
    '</ul>' +
    `<p><a href="${BOOK_URL}">Book now on Florida State Parks →</a></p>`;

  // SMS: keep it short.
  const first = openings[0];
  const more = n > 1 ? ` (+${n - 1} more)` : '';
  const smsBody =
    `${CFG.parkName} cabin open: ${first.unit} ${fmtDate(first.checkIn)}-${fmtDate(first.checkOut)}${more}. ` +
    `Book: ${BOOK_URL}`;

  return { title, textBody, htmlBody, smsBody };
}

async function notifyNtfy(title, body) {
  const headers = {
    Title: asciiHeader(title),
    Priority: 'urgent',
    Tags: 'palm_tree,tent',
    Click: BOOK_URL,
    'User-Agent': CFG.userAgent,
  };
  if (CFG.ntfyToken) headers.Authorization = `Bearer ${CFG.ntfyToken}`;
  await withRetry(async () => {
    const res = await fetchT(`${CFG.ntfyServer.replace(/\/$/, '')}/${CFG.ntfyTopic}`, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ntfy HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
  });
  log('ntfy push sent.');
}

function makeTransport() {
  if (!nodemailer) throw new Error('nodemailer not installed (run: npm install)');
  return nodemailer.createTransport({
    host: CFG.smtpHost,
    port: CFG.smtpPort,
    secure: CFG.smtpSecure,
    auth: CFG.smtpUser ? { user: CFG.smtpUser, pass: CFG.smtpPass } : undefined,
    connectionTimeout: CFG.httpTimeoutMs,
    greetingTimeout: CFG.httpTimeoutMs,
    socketTimeout: CFG.httpTimeoutMs,
  });
}

async function notifyEmail(title, textBody, htmlBody) {
  const transport = makeTransport();
  await withRetry(() => transport.sendMail({
    from: CFG.emailFrom || CFG.smtpUser,
    to: CFG.emailTo,
    subject: title,
    text: textBody,
    html: htmlBody,
  }));
  log('email sent to ' + CFG.emailTo);
}

// Real text on your phone with no Twilio/A2P: email the short body to the
// carrier's email-to-SMS gateway. Kept plain + short so it renders as one text.
async function notifyEmailSms(smsBody) {
  const transport = makeTransport();
  const to = CFG.emailSmsTo.split(',').map((s) => s.trim()).filter(Boolean);
  await withRetry(() => transport.sendMail({
    from: CFG.emailFrom || CFG.smtpUser,
    to,
    subject: '', // carriers prepend the subject; keep it empty for a clean text
    text: smsBody,
  }));
  log('text-via-email-gateway sent to ' + to.join(', '));
}

async function notifySms(smsBody) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${CFG.twilioSid}/Messages.json`;
  const recipients = CFG.smsTo.split(',').map((s) => s.trim()).filter(Boolean);
  for (const to of recipients) {
    const form = new URLSearchParams({ To: to, From: CFG.twilioFrom, Body: smsBody });
    const res = await fetchT(url, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${CFG.twilioSid}:${CFG.twilioToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`twilio HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  }
  log('SMS sent to ' + recipients.join(', '));
}

// Run a channel factory; log + swallow failure. Returns true on success.
function guard(name, factory) {
  return Promise.resolve()
    .then(factory)
    .then(() => true)
    .catch((e) => { log(`channel ${name} failed: ${e.message}`); return false; });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(CFG.stateFile, 'utf8'));
  } catch {
    return { seen: [] };
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(CFG.stateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    log('WARNING: could not write state file: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function tryRequire(m) { try { return require(m); } catch { return null; } }

function env(k, d) { return process.env[k] != null && process.env[k] !== '' ? process.env[k] : d; }
function intEnv(k, d) { const v = env(k, null); return v == null ? d : parseInt(v, 10); }
function boolEnv(k, d) { const v = env(k, null); return v == null ? d : /^(1|true|yes|on)$/i.test(v); }

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoOf(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseIso(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function mmddyyyy(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${m}-${day}-${d.getFullYear()}`;
}
function fmtDate(iso) {
  const d = parseIso(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function nowIso() { return new Date().toISOString(); }
// HTTP header values must be latin1/ASCII. Strip emoji & non-ASCII, tidy spaces.
function asciiHeader(s) {
  return String(s).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Logs go to stderr so stdout is reserved for clean JSON (--json / --test).
// The cron redirects 2>&1, so watcher.log still captures everything.
function log(msg) { console.error(`[${nowIso()}] ${msg}`); }

// Minimal .env loader (no dependency). KEY=VALUE per line, # comments, optional quotes.
function loadDotenv(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1); // quoted value: keep verbatim
    } else {
      v = v.replace(/\s+#.*$/, '').trim(); // unquoted: strip trailing inline comment
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

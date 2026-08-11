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

(async function main() {
  try {
    const openings = await scanOpenings();

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

    const state = loadState();
    // We dedupe at the individual free-night level: a key is `unitId|date`.
    // An opening is "new" only if it contains at least one free night we haven't
    // already alerted on. This means a window shrinking (a night gets booked)
    // never re-alerts, and only genuinely newly-freed nights trigger a ping.
    const seen = new Set(state.seenNights || []);
    const nightKey = (o, d) => `${o.unitId}|${d}`;

    const fresh = openings.filter((o) => o.nightDates.some((d) => !seen.has(nightKey(o, d))));

    if (openings.length === 0) {
      if (!CFG.quiet) log('No cabin availability found.');
    } else {
      log(`${openings.length} open cabin window(s) found` +
          (fresh.length ? `, ${fresh.length} with new nights.` : `, nothing new.`));
    }

    if (DRY) {
      log(`DRY RUN: would ${fresh.length ? 'notify about ' + fresh.length + ' opening(s)' : 'send nothing'}; state unchanged.`);
      return;
    }

    let alertedOk = false;
    if (fresh.length > 0) {
      alertedOk = await notifyAll(fresh);
    }

    // Persist the set of free nights we've accounted for. Rules:
    //  - keep nights that were already seen AND are still open (stable memory);
    //  - add a fresh opening's nights ONLY if the alert actually got out (so a
    //    failed send is retried next run, never silently dropped);
    //  - nights that are no longer free drop out, so if they reopen we re-alert.
    const keep = new Set();
    for (const o of openings) {
      for (const d of o.nightDates) {
        const k = nightKey(o, d);
        if (seen.has(k)) keep.add(k);
      }
    }
    if (alertedOk) {
      for (const o of fresh) for (const d of o.nightDates) keep.add(nightKey(o, d));
    }
    saveState({ seenNights: [...keep], updated: nowIso() });
  } catch (err) {
    log('ERROR: ' + (err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
})();

// ---------------------------------------------------------------------------
// Availability scan
// ---------------------------------------------------------------------------
async function scanOpenings() {
  const today = new Date();
  const windowStart = addDays(startOfDay(today), CFG.startOffsetDays);
  const windowEnd = CFG.watchEnd
    ? parseIso(CFG.watchEnd)
    : addDays(startOfDay(today), CFG.monthsAhead * 30);
  const hardStart = CFG.watchStart ? parseIso(CFG.watchStart) : windowStart;

  // Collect free-night sets per unit across the whole window by paging in
  // 21-day grids (the API returns 21 daily slices per call).
  const units = new Map(); // unitId -> { name, isAda, free:Set<isoDate>, minStay:Map }
  let cursor = new Date(windowStart);
  const PAGE_DAYS = 21;
  let pages = 0;
  const MAX_PAGES = 60; // safety cap (~3.4 years)

  while (cursor <= windowEnd && pages < MAX_PAGES) {
    pages++;
    const grid = await fetchGrid(cursor);
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
    cursor = addDays(cursor, PAGE_DAYS);
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
  return openings;
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
  const res = await fetchT(CFG.apiBase + 'search/grid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': CFG.userAgent,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`grid HTTP ${res.status} for ${body.StartDate}`);
  return res.json();
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

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
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
function log(msg) { console.log(`[${nowIso()}] ${msg}`); }

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

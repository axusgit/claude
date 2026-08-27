#!/usr/bin/env node
/*
 * Bahia Honda cabin FAST-ALERT sniper.
 *
 * Goal (Andy): ANY 2-night stay, ANY cabin (#001-#006), ANY date within the
 * real bookable window. The instant a genuinely-bookable opening appears — the
 * daily 8:00 AM ET release of the new 11-month arrival day, or a cancellation —
 * fire a loud push so Andy (already logged in) books it immediately.
 *
 * BOOKABILITY (the important correction): a stay is bookable only if, per the
 * ground-truth getbyunit endpoint, BOTH nights are free (IsFree && !IsReserved
 * && !IsBlocked) AND the arrival date is within furthest-arrival = today + 11
 * months. Dates past that show IsFree but are NOT yet arrivable (future release
 * inventory), so we exclude them to avoid false alerts.
 *
 * Modes:
 *   node sniper.js --once           # scan now, print bookable stays (read-only)
 *   node sniper.js --hunt           # loop every HUNT_SEC, alert on new bookable openings (cancellations + release)
 *   node sniper.js --arm            # burst-poll the 8AM release window at INTERVAL_MS, alert instantly
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = 'https://floridardr.usedirect.com/Floridardr/rdr/';
const CABINS = { '#001': 177, '#002': 173, '#003': 174, '#004': 175, '#005': 176, '#006': 172 };
const NIGHTS = 2;
const SCAN_NIGHTS = 340; // getbyunit span per cabin to cover the whole ~11-month window in one call
const H = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Origin: 'https://reserve.floridastateparks.org', Referer: 'https://reserve.floridastateparks.org/',
};

const nodemailer = (() => { try { return require('nodemailer'); } catch { return null; } })(); // resolves to ../node_modules

loadDotenv(path.join(__dirname, '..', '.env'));
const CFG = loadCfg();
const STATE_FILE = path.join(__dirname, 'sniper-state.json');
const BOOK_URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12';

function loadCfg() {
  const d = { intervalMs: 100, huntSec: 30, windowStartET: '07:59:55', windowEndET: '08:00:55',
    ntfyTopic: env('NTFY_TOPIC', ''), ntfyServer: env('NTFY_SERVER', 'https://ntfy.sh'), ntfyToken: env('NTFY_TOKEN', ''),
    // email + SMS-gateway (reuse the watcher's .env values)
    smtpHost: env('SMTP_HOST', ''), smtpPort: intEnv('SMTP_PORT', 587), smtpSecure: boolEnv('SMTP_SECURE', false),
    smtpUser: env('SMTP_USER', ''), smtpPass: env('SMTP_PASS', ''),
    emailFrom: env('EMAIL_FROM', ''), emailTo: env('EMAIL_TO', ''), emailSmsTo: env('EMAIL_SMS_TO', '') };
  try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'sniper.config.json'), 'utf8')); return { ...d, ...j, ntfyTopic: j.ntfyTopic || d.ntfyTopic }; } catch { return d; }
}

// ---- bookability (ground truth) ---------------------------------------------
function furthestArrivalISO() { const t = startOfToday(); const f = new Date(t.getFullYear(), t.getMonth() + 11, t.getDate()); return iso(f); }

async function freeDatesFor(unitId) {
  const url = `${API}fd/availability/getbyunit/${unitId}/startdate/${iso(startOfToday())}/nights/${SCAN_NIGHTS}/false`;
  const res = await fetchT(url, { headers: H }, 8000);
  if (!res.ok) throw new Error(`getbyunit ${unitId} HTTP ${res.status}`);
  const arr = await res.json();
  const free = new Set();
  for (const s of (Array.isArray(arr) ? arr : [])) if (s.IsFree && !s.IsReserved && !s.IsBlocked && !s.IsLocked && s.StartTime) free.add(s.StartTime.slice(0, 10));
  return free;
}

// Scan all cabins → list of genuinely-bookable 2-night stays.
async function scanBookable() {
  const furthest = furthestArrivalISO();
  const results = await Promise.all(Object.entries(CABINS).map(async ([name, id]) => {
    try { return { name, free: await freeDatesFor(id) }; } catch { return { name, free: new Set() }; }
  }));
  const stays = [];
  for (const { name, free } of results) {
    for (const d of [...free].sort()) {
      if (d > furthest) continue;                 // arrival must be within the 11-month window
      const n2 = iso(addDays(parseIso(d), 1));
      if (free.has(n2)) stays.push({ cabin: name, arrival: d, depart: iso(addDays(parseIso(d), NIGHTS)), key: `${name}|${d}` });
    }
  }
  stays.sort((a, b) => (a.arrival < b.arrival ? -1 : 1));
  return { stays, furthest };
}

// Focused fast poll of just the release day(s): the newest arrivable date(s).
async function scanReleaseEdge() {
  const furthest = furthestArrivalISO();
  const edge = [furthest, iso(addDays(parseIso(furthest), -1))]; // the new day + the one before (both freshly contested)
  const results = await Promise.all(Object.entries(CABINS).map(async ([name, id]) => {
    try { return { name, free: await freeDatesFor(id) }; } catch { return { name, free: new Set() }; }
  }));
  const stays = [];
  for (const { name, free } of results) for (const d of edge) {
    const n2 = iso(addDays(parseIso(d), 1));
    if (free.has(d) && free.has(n2)) stays.push({ cabin: name, arrival: d, depart: iso(addDays(parseIso(d), NIGHTS)), key: `${name}|${d}` });
  }
  return { stays, furthest };
}

// ---- modes ------------------------------------------------------------------
async function once() {
  const { stays, furthest } = await scanBookable();
  log(`furthest bookable arrival = ${furthest}. Bookable 2-night stays now: ${stays.length}`);
  for (const s of stays) log(`  Cabin ${s.cabin}: ${s.arrival} → ${s.depart}`);
  if (!stays.length) log('(nothing bookable — expected; the window is booked solid until the next 8AM release / a cancellation.)');
}

// One scan + alert-on-new + persist; returns fresh count. Shared by --hunt/--tick.
async function huntOnce(seen) {
  let stays = [];
  try { ({ stays } = await scanBookable()); } catch (e) { log('scan error: ' + e.message); return 0; }
  const fresh = stays.filter((s) => !seen[s.key]);
  if (fresh.length) { await alert(fresh, 'opening'); fresh.forEach((s) => (seen[s.key] = Date.now())); }
  pruneSeen(seen); saveSeen(seen);
  return fresh.length;
}

async function tick() { // one-shot, for cron
  const seen = loadSeen();
  const n = await huntOnce(seen);
  if (!n) log('tick: nothing new bookable.');
}

async function hunt() { // long-lived loop, for interactive use
  log(`HUNT: scanning all 6 cabins every ${CFG.huntSec}s for any bookable 2-night opening. Ctrl-C to stop.`);
  const seen = loadSeen();
  for (;;) { await huntOnce(seen); await sleep(CFG.huntSec * 1000); }
}

async function arm() {
  log(`ARMED for the 8AM release. Waiting for ${CFG.windowStartET} ET (now ${etHMS()} ET)…`);
  while (etHMS() < CFG.windowStartET) await sleep(200);
  log(`Release window OPEN at ${etHMS()} ET — burst polling the edge every ${CFG.intervalMs}ms.`);
  const seen = loadSeen(); // shared with --tick so neither double-alerts
  let polls = 0, hits = 0;
  while (etHMS() < CFG.windowEndET) {
    polls++;
    let stays = [];
    try { ({ stays } = await scanReleaseEdge()); } catch { /* keep going */ }
    const fresh = stays.filter((s) => !seen[s.key]);
    if (fresh.length) { await alert(fresh, 'RELEASE'); fresh.forEach((s) => (seen[s.key] = Date.now())); saveSeen(seen); hits += fresh.length; }
    await sleep(CFG.intervalMs);
  }
  pruneSeen(seen); saveSeen(seen);
  log(`Release window closed after ${polls} polls; ${hits} opening(s) alerted.`);
}

// ---- alerts (ntfy + email + SMS-gateway) ------------------------------------
async function alert(stays, kind) {
  const first = stays[0];
  const title = `🏝️ Bahia cabin ${kind === 'RELEASE' ? 'RELEASE' : 'OPEN'}: ${first.cabin} ${first.arrival}${stays.length > 1 ? ` (+${stays.length - 1})` : ''}`;
  const lines = stays.slice(0, 10).map((s) => `• Cabin ${s.cabin}: ${s.arrival} → ${s.depart}`).join('\n');
  const textBody = `BOOK NOW — ${stays.length} bookable 2-night cabin opening(s):\n${lines}\n\n${BOOK_URL}`;
  const htmlBody = `<h2>${ascii(title)}</h2><p>${stays.length} bookable 2-night cabin opening(s) — book immediately:</p><ul>` +
    stays.slice(0, 10).map((s) => `<li><b>Cabin ${s.cabin}</b>: ${s.arrival} → ${s.depart}</li>`).join('') +
    `</ul><p><a href="${BOOK_URL}">Book now on Florida State Parks →</a></p>`;
  const smsBody = `Bahia cabin open: ${first.cabin} ${first.arrival}${stays.length > 1 ? ` (+${stays.length - 1})` : ''}. Book: ${BOOK_URL}`;
  log('ALERT: ' + ascii(title));

  const jobs = [];
  if (CFG.ntfyTopic) jobs.push(guard('ntfy', () => notifyNtfy(title, textBody)));
  if (nodemailer && CFG.smtpHost && CFG.emailTo) jobs.push(guard('email', () => notifyEmail(title, textBody, htmlBody)));
  if (nodemailer && CFG.smtpHost && CFG.emailSmsTo) jobs.push(guard('sms', () => notifyEmailSms(smsBody)));
  if (!jobs.length) { log('(no alert channel configured)'); return; }
  await Promise.all(jobs);
}

function guard(name, fn) { return Promise.resolve().then(fn).then(() => log(name + ' sent.')).catch((e) => log(`channel ${name} failed: ${e.message}`)); }

async function notifyNtfy(title, body) {
  const headers = { Title: ascii(title), Priority: 'urgent', Tags: 'dart,palm_tree', Click: BOOK_URL };
  if (CFG.ntfyToken) headers.Authorization = `Bearer ${CFG.ntfyToken}`;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetchT(`${CFG.ntfyServer.replace(/\/$/, '')}/${CFG.ntfyTopic}`, { method: 'POST', headers, body }, 8000); if (r.ok) return; lastErr = new Error('HTTP ' + r.status); } catch (e) { lastErr = e; }
    await sleep(1500);
  }
  throw lastErr;
}
function makeTransport() {
  return nodemailer.createTransport({ host: CFG.smtpHost, port: CFG.smtpPort, secure: CFG.smtpSecure,
    auth: CFG.smtpUser ? { user: CFG.smtpUser, pass: CFG.smtpPass } : undefined,
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 20000 });
}
async function notifyEmail(title, textBody, htmlBody) {
  await makeTransport().sendMail({ from: CFG.emailFrom || CFG.smtpUser, to: CFG.emailTo, subject: title, text: textBody, html: htmlBody });
}
async function notifyEmailSms(smsBody) {
  const to = CFG.emailSmsTo.split(',').map((s) => s.trim()).filter(Boolean);
  await makeTransport().sendMail({ from: CFG.emailFrom || CFG.smtpUser, to, subject: '', text: smsBody });
}

// ---- state ------------------------------------------------------------------
function loadSeen() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).seen || {}; } catch { return {}; } }
function saveSeen(seen) { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ seen, updated: new Date().toISOString() }, null, 2)); } catch {} }
function pruneSeen(seen) { const today = iso(startOfToday()); for (const k of Object.keys(seen)) { const d = k.split('|')[1]; if (d && d < today) delete seen[k]; } }

// ---- main -------------------------------------------------------------------
(async () => {
  const a = process.argv;
  try {
    if (a.includes('--testalert')) {
      const title = 'TEST - Bahia fast-alert sniper (all channels)';
      const text = 'TEST: fast-alert sniper channels working. Real alerts fire when a bookable 2-night cabin opening appears. ' + BOOK_URL;
      const html = `<h2>${title}</h2><p>Test of ntfy + email + SMS. Real alerts include cabin, dates, and a <a href="${BOOK_URL}">booking link</a>.</p>`;
      const jobs = [];
      if (CFG.ntfyTopic) jobs.push(guard('ntfy', () => notifyNtfy(title, text)));
      if (nodemailer && CFG.smtpHost && CFG.emailTo) jobs.push(guard('email', () => notifyEmail(title, text, html)));
      if (nodemailer && CFG.smtpHost && CFG.emailSmsTo) jobs.push(guard('sms', () => notifyEmailSms(text)));
      log(`nodemailer loaded: ${!!nodemailer} | channels: ntfy=${!!CFG.ntfyTopic} email=${!!(CFG.smtpHost && CFG.emailTo)} sms=${!!(CFG.smtpHost && CFG.emailSmsTo)}`);
      await Promise.all(jobs);
    }
    else if (a.includes('--hunt')) await hunt();
    else if (a.includes('--tick')) await tick();
    else if (a.includes('--arm')) await arm();
    else if (a.includes('--once') || a.includes('--scan')) await once();
    else console.log('Usage: node sniper.js [--once | --tick | --hunt | --arm]');
  } catch (e) { log('ERROR: ' + (e.stack || e)); process.exitCode = 1; }
})();

// ---- helpers ----------------------------------------------------------------
function iso(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; }
function parseIso(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfToday() { const x = new Date(); x.setHours(0, 0, 0, 0); return x; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function etHMS() { return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/[^\d:]/g, '').slice(-8); }
async function fetchT(url, opts, ms) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms || 8000); try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); } }
function ascii(s) { return String(s).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim(); }
function log(m) { console.error(`[${new Date().toISOString()}] ${m}`); }
function env(k, d) { return process.env[k] != null && process.env[k] !== '' ? process.env[k] : d; }
function intEnv(k, d) { const v = env(k, null); return v == null ? d : parseInt(v, 10); }
function boolEnv(k, d) { const v = env(k, null); return v == null ? d : /^(1|true|yes|on)$/i.test(v); }
function loadDotenv(f) { let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { return; } for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i); if (!m) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '').trim(); if (process.env[m[1]] == null) process.env[m[1]] = v; } }

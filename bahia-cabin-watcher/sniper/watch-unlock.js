#!/usr/bin/env node
/*
 * One-off focused watch: Cabin #004 (unit 175), Sep 3-6 2026 (4 nights), currently
 * locked (Andy's failed-checkout cart hold, LockExpiration ~2026-08-26 14:12 ET).
 * Polls those exact nights every few seconds and, the instant they unlock (all free,
 * not locked/reserved/blocked), fires ntfy + email + SMS so Andy can re-book fast.
 * Exits after alerting, or after a max runtime.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const nodemailer = (() => { try { return require('nodemailer'); } catch { return null; } })();

const API = 'https://floridardr.usedirect.com/Floridardr/rdr/';
const UNIT = 175, CABIN = '#004';
const NIGHTS = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
const ARRIVAL = NIGHTS[0], DEPART = '2026-09-07';
const POLL_MS = 3000, MAX_MIN = 60;
const BOOK_URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12';

loadDotenv(path.join(__dirname, '..', '.env'));
const NTFY_TOPIC = env('NTFY_TOPIC', ''), NTFY_SERVER = env('NTFY_SERVER', 'https://ntfy.sh'), NTFY_TOKEN = env('NTFY_TOKEN', '');
const SMTP = { host: env('SMTP_HOST', ''), port: parseInt(env('SMTP_PORT', '587'), 10), secure: /^(1|true|yes|on)$/i.test(env('SMTP_SECURE', '')), user: env('SMTP_USER', ''), pass: env('SMTP_PASS', '') };
const EMAIL_FROM = env('EMAIL_FROM', ''), EMAIL_TO = env('EMAIL_TO', ''), EMAIL_SMS_TO = env('EMAIL_SMS_TO', '');

const H = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/126', Origin: 'https://reserve.floridastateparks.org', Referer: 'https://reserve.floridastateparks.org/' };

async function pollFree() {
  const r = await fetch(`${API}fd/availability/getbyunit/${UNIT}/startdate/${ARRIVAL}/nights/6/false`, { headers: H });
  const arr = await r.json().catch(() => []);
  const freeDates = new Set((Array.isArray(arr) ? arr : []).filter((s) => s.IsFree && !s.IsReserved && !s.IsBlocked && !s.IsLocked).map((s) => (s.StartTime || '').slice(0, 10)));
  return NIGHTS.filter((d) => freeDates.has(d));
}

async function alertAll(title, text, html, sms) {
  const jobs = [];
  if (NTFY_TOPIC) jobs.push(sendNtfy(title, text).then(() => log('ntfy sent')).catch((e) => log('ntfy fail ' + e.message)));
  if (nodemailer && SMTP.host && EMAIL_TO) jobs.push(sendMail(EMAIL_TO, title, text, html).then(() => log('email sent')).catch((e) => log('email fail ' + e.message)));
  if (nodemailer && SMTP.host && EMAIL_SMS_TO) jobs.push(sendMail(EMAIL_SMS_TO.split(',').map((s) => s.trim()), '', sms, null).then(() => log('sms sent')).catch((e) => log('sms fail ' + e.message)));
  await Promise.all(jobs);
}
async function sendNtfy(title, body) {
  const headers = { Title: ascii(title), Priority: 'urgent', Tags: 'unlock,palm_tree', Click: BOOK_URL };
  if (NTFY_TOKEN) headers.Authorization = 'Bearer ' + NTFY_TOKEN;
  const r = await fetch(`${NTFY_SERVER.replace(/\/$/, '')}/${NTFY_TOPIC}`, { method: 'POST', headers, body });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
function tx() { return nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.secure, auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 20000 }); }
async function sendMail(to, subject, text, html) { await tx().sendMail({ from: EMAIL_FROM || SMTP.user, to, subject, text, ...(html ? { html } : {}) }); }

(async () => {
  const t0 = Date.now();
  log(`Watching Cabin ${CABIN} ${ARRIVAL}..${DEPART} (4 nights) every ${POLL_MS}ms, up to ${MAX_MIN} min.`);
  let alerted = false;
  while (Date.now() - t0 < MAX_MIN * 60000) {
    let free = [];
    try { free = await pollFree(); } catch (e) { log('poll err ' + e.message); }
    if (free.length === NIGHTS.length) {
      log('ALL 4 NIGHTS FREE — alerting.');
      await alertAll(
        `🔓 Bahia Cabin ${CABIN} UNLOCKED: ${ARRIVAL}→${DEPART}`,
        `Cabin ${CABIN} Sep 3-6, 2026 (4 nights) just unlocked and is BOOKABLE. Book NOW: ${BOOK_URL}`,
        `<h2>Cabin ${CABIN} unlocked — Sep 3-6, 2026</h2><p>All 4 nights are free again. <a href="${BOOK_URL}">Book now →</a> before someone else grabs them.</p>`,
        `Bahia Cabin ${CABIN} Sep 3-6 2026 UNLOCKED - book now: ${BOOK_URL}`);
      alerted = true; break;
    }
    if (free.length > 0) log(`partial: ${free.length}/4 free (${free.join(',')}) — waiting for all 4`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!alerted) {
    // Ran out of time — tell Andy so he isn't left hanging.
    const free = await pollFree().catch(() => []);
    await alertAll(`Bahia Cabin ${CABIN} watch ended`,
      `Watch on Cabin ${CABIN} Sep 3-6 ended after ${MAX_MIN} min. Currently ${free.length}/4 nights free. Check: ${BOOK_URL}`,
      `<p>Watch ended. ${free.length}/4 nights free. <a href="${BOOK_URL}">Check the site →</a></p>`,
      `Bahia Cabin ${CABIN} watch ended: ${free.length}/4 free. ${BOOK_URL}`).catch(() => {});
    log('Max runtime reached; sent status.');
  }
  process.exit(0);
})();

function env(k, d) { return process.env[k] != null && process.env[k] !== '' ? process.env[k] : d; }
function ascii(s) { return String(s).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim(); }
function log(m) { console.error(`[${new Date().toISOString()}] ${m}`); }
function loadDotenv(f) { let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { return; } for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i); if (!m) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '').trim(); if (process.env[m[1]] == null) process.env[m[1]] = v; } }

'use strict';

// Keyword-based ntfy alerts for incoming syslog messages. When a message contains
// one of the configured keywords (default "No Service"), push an ntfy notification.
// Throttled per host+keyword so a device that repeats the message can't flood you.
//
// Config (env):
//   ALERT_NTFY_TOPIC   ntfy topic to publish to (required to enable alerts)
//   ALERT_KEYWORDS     comma-separated, case-insensitive substrings (default "No Service")
//   ALERT_COOLDOWN_SEC min seconds between alerts for the same host+keyword (default 300)
//   NTFY_BASE          ntfy server base (default https://ntfy.sh)

const TOPIC = (process.env.ALERT_NTFY_TOPIC || '').trim();
const KEYWORDS = (process.env.ALERT_KEYWORDS || 'No Service')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const COOLDOWN_MS = Math.max(0, Number(process.env.ALERT_COOLDOWN_SEC || 300)) * 1000;
const NTFY_BASE = (process.env.NTFY_BASE || 'https://ntfy.sh').replace(/\/$/, '');
// Optional ntfy access token — an authenticated account has a far higher daily
// quota than anonymous (which is per-IP and easily exhausted by chatty senders).
const NTFY_TOKEN = (process.env.ALERT_NTFY_TOKEN || '').trim();
// Dead-man's switch: if no syslog is received for this many seconds, alert (the
// phones stopped / lost service). 0 disables. Default 120 (2 min).
const SILENCE_SEC = Math.max(0, Number(process.env.SILENCE_ALERT_SEC || 120));

// --- email (SMTP, e.g. Microsoft 365) ---
// Optional second alert channel. When configured, device + silence alerts also go
// out by email. Everything stays best-effort: a missing/broken SMTP config never
// blocks ntfy or ingest.
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER || '').trim();
const EMAIL_TO = (process.env.ALERT_EMAIL_TO || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let _transport = null;
let _nodemailer = null;
function emailConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM && EMAIL_TO.length);
}
function transport() {
  if (_transport) return _transport;
  if (!emailConfigured()) return null;
  try {
    if (!_nodemailer) _nodemailer = require('nodemailer');
  } catch (err) {
    console.error('[alert] nodemailer not installed — email disabled:', err.message);
    return null;
  }
  _transport = _nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465=implicit TLS; 587=STARTTLS
    requireTLS: SMTP_PORT !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transport;
}

// Send an email. Resolves { ok } / { ok:false, error }. Never throws.
async function sendEmail({ subject, text }) {
  const t = transport();
  if (!t) return { ok: false, error: 'Email (SMTP) is not configured on the server.' };
  try {
    await t.sendMail({
      from: SMTP_FROM,
      to: EMAIL_TO.join(', '),
      subject: String(subject || 'Axus Syslog alert').slice(0, 200),
      text: String(text || ''),
    });
    return { ok: true };
  } catch (err) {
    console.error('[alert] email send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

const lastSent = new Map(); // "host|keyword(lower)" -> ms epoch of last alert

function topicSet() {
  return Boolean(TOPIC);
}
function enabled() {
  return topicSet() && KEYWORDS.length > 0;
}

// Strip non-Latin1 chars — ntfy request headers (Title/Tags) must be ISO-8859-1.
function asciiHeader(s) {
  return String(s || '').replace(/[^\x20-\x7E]/g, '?').slice(0, 200);
}

// Generic ntfy publish to the configured topic. Never throws.
function notify({ title, body, tags = 'rotating_light,warning', priority = 'high' }) {
  if (!topicSet()) return;
  const headers = { Title: asciiHeader(title), Priority: priority, Tags: asciiHeader(tags) };
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  fetch(`${NTFY_BASE}/${TOPIC}`, {
    method: 'POST',
    headers,
    body: String(body || '').slice(0, 3500),
    signal: AbortSignal.timeout(8000),
  })
    .then((res) => { if (!res.ok) console.error(`[alert] ntfy returned HTTP ${res.status} (${title})`); })
    .catch((err) => console.error('[alert] ntfy send failed:', err.message));
}

// Fire an alert to BOTH channels (ntfy push + email). Best-effort on each; used
// for device up/down alerts so they reach the phone AND the inbox.
function notifyAll({ title, body, tags, priority }) {
  notify({ title, body, tags, priority });
  if (emailConfigured()) {
    sendEmail({ subject: title, text: body }).catch(() => {});
  }
}

// A monitored device went offline / came back. Sends to ntfy + email.
function deviceAlert(device, { down, quietSec }) {
  const mins = Math.round((quietSec || 0) / 60);
  if (down) {
    notifyAll({
      title: `Device offline: ${device.name}`,
      body: `"${device.name}" has stopped sending syslog. No matching message for ~${mins} min ` +
        `(threshold ${device.interval_sec}s). Match rule: ${device.match_type} "${device.match_value}". ` +
        `It may have lost power, network, or service.`,
      tags: 'rotating_light,warning',
      priority: 'urgent',
    });
  } else {
    notifyAll({
      title: `Device back online: ${device.name}`,
      body: `"${device.name}" is sending syslog again as of ${new Date().toISOString()}.`,
      tags: 'white_check_mark',
      priority: 'default',
    });
  }
}

function send(keyword, host, text) {
  notify({
    title: `Syslog alert: "${keyword}" from ${host}`,
    body: `${host}: ${text}`,
  });
}

// Check a parsed message row and fire an alert if it matches a keyword (throttled).
function maybeAlert(row) {
  if (!enabled()) return;
  const text = String((row && (row.message || row.raw)) || '');
  if (!text) return;
  const hay = text.toLowerCase();
  for (const kw of KEYWORDS) {
    if (hay.includes(kw.toLowerCase())) {
      const host = (row.host || row.sourceIp || row.source_ip || 'unknown');
      const key = `${host}|${kw.toLowerCase()}`;
      const now = Date.now();
      if (now - (lastSent.get(key) || 0) < COOLDOWN_MS) return; // throttled
      lastSent.set(key, now);
      send(kw, host, text);
      return; // one alert per message
    }
  }
}

// --- silence watchdog (no-syslog-received alert) ---
let silent = false; // current state: are we in a silence period?
function resetSilence() { silent = false; }
// Called on an interval with the epoch-ms of the last received message and the
// threshold (seconds) from the dashboard's Watchdog settings. Fires one alert when
// ingest goes quiet past the threshold, and one recovery when it resumes.
function checkSilence(lastMsgTs, thresholdSec) {
  const sec = Number(thresholdSec) || SILENCE_SEC;
  if (!topicSet() || !(sec > 0)) return;
  const quietMs = Date.now() - Number(lastMsgTs || 0);
  const nowSilent = quietMs > sec * 1000;
  if (nowSilent && !silent) {
    silent = true;
    const mins = Math.round(quietMs / 60000);
    notify({
      title: 'No syslog received - phones may be down',
      body: `No syslog messages have arrived for ~${mins} min (threshold ${sec}s). The phones may have lost service / "No Service", stopped, or lost network. Last message was ${new Date(Number(lastMsgTs)).toISOString()}.`,
      tags: 'rotating_light,warning',
      priority: 'urgent',
    });
    console.error(`[silence] ALERT: no syslog for ${Math.round(quietMs / 1000)}s`);
  } else if (!nowSilent && silent) {
    silent = false;
    notify({
      title: 'Syslog resumed',
      body: `Syslog messages are arriving again as of ${new Date().toISOString()}.`,
      tags: 'white_check_mark',
      priority: 'default',
    });
    console.log('[silence] RECOVERED: syslog flowing again');
  }
}

// Send a test alert and report the actual result (awaited) so the UI can confirm.
async function sendTest() {
  if (!topicSet()) return { ok: false, error: 'No ntfy topic configured on the server.' };
  const headers = {
    Title: asciiHeader('Test alert - Axus Syslog'),
    Priority: 'default',
    Tags: 'white_check_mark,test_tube',
  };
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  try {
    const res = await fetch(`${NTFY_BASE}/${TOPIC}`, {
      method: 'POST',
      headers,
      body: `Test alert from Axus Syslog at ${new Date().toISOString()} — if this reached your phone, ntfy alerts are working.`,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `ntfy returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Send a test email and report the result (awaited) so the UI can confirm delivery.
async function sendTestEmail() {
  if (!emailConfigured()) return { ok: false, error: 'Email (SMTP) is not configured on the server.' };
  return sendEmail({
    subject: 'Test alert — Axus Syslog',
    text: `Test email from Axus Syslog at ${new Date().toISOString()} — if this reached your inbox, email alerts are working.`,
  });
}

module.exports = {
  maybeAlert, notify, notifyAll, deviceAlert, sendTest, sendTestEmail, sendEmail,
  checkSilence, resetSilence, enabled, topicSet, emailConfigured,
  KEYWORDS, TOPIC, SILENCE_SEC, EMAIL_TO,
};

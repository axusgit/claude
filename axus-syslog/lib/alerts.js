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

module.exports = { maybeAlert, notify, sendTest, checkSilence, resetSilence, enabled, topicSet, KEYWORDS, TOPIC, SILENCE_SEC };

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

const lastSent = new Map(); // "host|keyword(lower)" -> ms epoch of last alert

function enabled() {
  return Boolean(TOPIC) && KEYWORDS.length > 0;
}

// Strip non-Latin1 chars — ntfy request headers (Title/Tags) must be ISO-8859-1.
function asciiHeader(s) {
  return String(s || '').replace(/[^\x20-\x7E]/g, '?').slice(0, 200);
}

function send(keyword, host, text) {
  const title = asciiHeader(`Syslog alert: "${keyword}" from ${host}`);
  const body = `${host}: ${text}`.slice(0, 3500); // body may be UTF-8
  const headers = { Title: title, Priority: 'high', Tags: 'rotating_light,warning' };
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  fetch(`${NTFY_BASE}/${TOPIC}`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(8000),
  })
    .then((res) => {
      // fetch only rejects on network errors — surface HTTP failures (e.g. 429
      // rate-limit) explicitly so a dropped alert is visible in the logs.
      if (!res.ok) console.error(`[alert] ntfy returned HTTP ${res.status} for "${keyword}" from ${host}`);
    })
    .catch((err) => console.error('[alert] ntfy send failed:', err.message));
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

module.exports = { maybeAlert, enabled, KEYWORDS, TOPIC };

'use strict';

require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');

const db = require('./lib/db');
const fw = require('./lib/firewall');
const alerts = require('./lib/alerts');
const { Collector } = require('./lib/collector');
const { severityName, facilityName } = require('./lib/parser');
const { loginPage, dashboardPage } = require('./lib/views');

const PORT = Number(process.env.PORT || 3260);
const UDP_PORT = Number(process.env.SYSLOG_UDP_PORT || 514);
const UDP_BIND = process.env.SYSLOG_BIND || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 0);
const MAX_ROWS = Number(process.env.MAX_ROWS || 0);

// Single sign-on via OpenID Connect against Authentik (Axus Hub identity). When
// enabled, users sign in through the Hub — no local password. The local
// username/password login stays as an emergency break-glass if ADMIN_PASSWORD is set.
const OIDC_ENABLED = process.env.OIDC_ENABLED === '1';
const OIDC_BASE = (process.env.OIDC_BASE || '').replace(/\/$/, ''); // e.g. https://id.hub.axustechnologies.com/application/o
const OIDC_SLUG = process.env.OIDC_SLUG || ''; // per-app slug, for end-session
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const OIDC_REDIRECT = `${(process.env.BASE_URL || '').replace(/\/$/, '')}/auth/callback`;

if (!ADMIN_PASSWORD && !OIDC_ENABLED) {
  console.error('FATAL: ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

// ------------------------------- collector -------------------------------
const collector = new Collector({ port: UDP_PORT, bind: UDP_BIND });
collector.start();

// Retention: logs auto-clear after RETENTION_DAYS (fixed; default 7). The sweep
// runs every minute and prunes anything older. No UI control — it just expires.
const RETENTION_DAYS_EFFECTIVE = RETENTION_DAYS > 0 ? RETENTION_DAYS : 7;
function sweep() {
  try {
    const n = db.prune({ retentionDays: RETENTION_DAYS_EFFECTIVE, maxRows: MAX_ROWS });
    if (n > 0) console.log(`[retention] pruned ${n} messages older than ${RETENTION_DAYS_EFFECTIVE}d`);
  } catch (err) {
    console.error('[retention] error:', err.message);
  }
}
setTimeout(sweep, 10000);
setInterval(sweep, 60000).unref();

// Silence watchdog — configurable from the dashboard's Watchdog tab. Settings live
// in the DB (watchdog_enabled / watchdog_sec); seed defaults on first run.
if (db.getSetting('watchdog_sec') == null) db.setSetting('watchdog_sec', String(alerts.SILENCE_SEC || 120));
if (db.getSetting('watchdog_enabled') == null) db.setSetting('watchdog_enabled', alerts.topicSet() ? '1' : '0');
function watchdogTick() {
  if (db.getSetting('watchdog_enabled') === '0') { alerts.resetSilence(); return; }
  const sec = Number(db.getSetting('watchdog_sec')) || alerts.SILENCE_SEC || 120;
  alerts.checkSilence(collector.lastMessageTs, sec);
}
setInterval(watchdogTick, 30000).unref();

// --------------------------------- web ----------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  cookieSession({
    name: 'axsyslog',
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000, // 12h
  })
);

function authed(req) {
  return req.session && req.session.user === ADMIN_USER;
}
function requireAuth(req, res, next) {
  if (authed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect(OIDC_ENABLED ? '/auth/login' : '/login');
}

// Constant-time credential check.
function checkCreds(user, pass) {
  const uOk = safeEqual(user || '', ADMIN_USER);
  const pOk = safeEqual(pass || '', ADMIN_PASSWORD);
  return uOk && pOk;
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still compare against something of equal length to reduce timing signal.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

app.get('/login', (req, res) => {
  if (authed(req)) return res.redirect('/');
  res.type('html').send(loginPage({}));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (checkCreds(username, password)) {
    req.session.user = ADMIN_USER;
    return res.redirect('/');
  }
  res.status(401).type('html').send(loginPage({ error: 'Invalid username or password.', user: username }));
});

// ---- OpenID Connect (Authentik SSO) ----
app.get('/auth/login', (req, res) => {
  if (!OIDC_ENABLED) return res.redirect('/login');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oidcState = state;
  const u = new URL(`${OIDC_BASE}/authorize/`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', OIDC_CLIENT_ID);
  u.searchParams.set('redirect_uri', OIDC_REDIRECT);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  res.redirect(u.toString());
});

app.get('/auth/callback', async (req, res) => {
  if (!OIDC_ENABLED) return res.redirect('/login');
  try {
    const { code, state } = req.query;
    if (!code || !state || !req.session || state !== req.session.oidcState) {
      return res.status(400).type('html').send(loginPage({ error: 'SSO state mismatch — please try again.' }));
    }
    req.session.oidcState = null;
    // Back-channel exchange: code -> tokens (server to Authentik, over TLS).
    const tokenRes = await fetch(`${OIDC_BASE}/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: OIDC_REDIRECT,
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
    const tok = await tokenRes.json();
    // Identity from userinfo (email/name for display; access itself is already
    // gated by Authentik's app-tools policy during authorization).
    let identity = { email: null, name: null };
    const uiRes = await fetch(`${OIDC_BASE}/userinfo/`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (uiRes.ok) {
      const ui = await uiRes.json();
      identity = { email: ui.email || ui.preferred_username || ui.sub || null, name: ui.name || ui.nickname || ui.email || null };
    }
    req.session.user = ADMIN_USER; // authenticated
    req.session.identity = identity;
    res.redirect('/');
  } catch (err) {
    console.error('[oidc] callback error:', err.message);
    res.status(502).type('html').send(loginPage({ error: 'SSO sign-in failed. Try again, or use break-glass login.' }));
  }
});

app.get('/logout', (req, res) => {
  req.session = null;
  // End the Authentik session too so the user isn't silently signed back in.
  if (OIDC_ENABLED && OIDC_BASE && OIDC_SLUG) {
    return res.redirect(`${OIDC_BASE}/${OIDC_SLUG}/end-session/`);
  }
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  res.type('html').send(dashboardPage());
});

// Healthcheck (no auth) — useful for the box uptime watcher.
app.get('/healthz', (req, res) => {
  res.json({ ok: true, received: collector.received });
});

// ------------------------------- JSON API -------------------------------
app.get('/api/messages', requireAuth, (req, res) => {
  const q = req.query;
  const result = db.query({
    q: q.q,
    host: q.host,
    sourceIp: q.sourceIp,
    app: q.app,
    facility: q.facility,
    maxSeverity: q.maxSeverity,
    since: q.since,
    until: q.until,
    limit: q.limit || 200,
    offset: q.offset || 0,
    order: 'desc',
  });
  res.json(result);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const s = db.stats();
  const errors24 = db.query({
    since: Date.now() - 86400000,
    maxSeverity: 3,
    limit: 1,
  }).total;
  res.json({ ...s, errors24, received: collector.received, dbBytes: db.dbSize(), retentionDays: RETENTION_DAYS_EFFECTIVE });
});

app.get('/api/facets', requireAuth, (req, res) => {
  res.json(db.facets());
});

// ---- watchdog (no-syslog alert) settings ----
const WATCHDOG_SECS = [60, 120, 180, 300, 600];
app.get('/api/watchdog', requireAuth, (req, res) => {
  res.json({
    enabled: db.getSetting('watchdog_enabled') !== '0',
    sec: Number(db.getSetting('watchdog_sec')) || alerts.SILENCE_SEC || 120,
    options: WATCHDOG_SECS,
    topicConfigured: alerts.topicSet(),
    lastMessageAgeSec: Math.round((Date.now() - collector.lastMessageTs) / 1000),
  });
});

app.post('/api/watchdog', requireAuth, (req, res) => {
  const b = req.body || {};
  if (typeof b.enabled === 'boolean') {
    db.setSetting('watchdog_enabled', b.enabled ? '1' : '0');
    if (!b.enabled) alerts.resetSilence();
  }
  if (b.sec != null) {
    const sec = Number(b.sec);
    if (!WATCHDOG_SECS.includes(sec)) return res.status(400).json({ error: 'Invalid check window.' });
    db.setSetting('watchdog_sec', String(sec));
  }
  res.json({
    ok: true,
    enabled: db.getSetting('watchdog_enabled') !== '0',
    sec: Number(db.getSetting('watchdog_sec')) || 120,
  });
});

// ---- test alert (verify ntfy delivery) ----
app.post('/api/alert/test', requireAuth, async (req, res) => {
  const r = await alerts.sendTest();
  if (r.ok) res.json({ ok: true });
  else res.status(502).json({ error: r.error || 'Test alert failed.' });
});

// ---- clear logs (manual purge older than N days; 7 is the automatic sweep) ----
app.post('/api/clearlogs', requireAuth, (req, res) => {
  const days = Number((req.body || {}).days);
  if (![1, 3, 5, 7].includes(days)) return res.status(400).json({ error: 'Invalid range (allowed: 1, 3, 5, 7 days).' });
  let deleted = 0;
  try { deleted = db.prune({ retentionDays: days }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  res.json({ ok: true, days, deleted });
});

// ---- export / download ----
function filtersFrom(q) {
  return {
    q: q.q, host: q.host, sourceIp: q.sourceIp, app: q.app,
    facility: q.facility, maxSeverity: q.maxSeverity,
    since: q.since, until: q.until,
  };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ISO 8601 timestamp in the server's local timezone WITH offset (e.g.
// 2026-08-24T15:04:05-04:00). The service runs with TZ=America/New_York, so this
// matches the wall-clock times shown in the dashboard and the selected Range.
function localIso(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

// Best-effort private (RFC1918) IPv4 found in a message body, else ''.
function privateIp(text) {
  const ips = String(text || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
  for (const ip of ips) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => n > 255)) continue;
    if (o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)) {
      return ip;
    }
  }
  return '';
}

app.get('/api/export', requireAuth, async (req, res) => {
  const format = ['csv', 'json', 'txt'].includes(req.query.format) ? req.query.format : 'csv';
  const order = req.query.order === 'desc' ? 'desc' : 'asc';
  const iso = localIso;
  const ext = format === 'json' ? 'ndjson' : format;
  const mime = format === 'csv'
    ? 'text/csv'
    : format === 'json' ? 'application/x-ndjson' : 'text/plain';

  res.set({
    'Content-Type': `${mime}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="axus-syslog-${stamp()}.${ext}"`,
    'Cache-Control': 'no-store',
  });

  let it;
  try {
    it = db.iterate(filtersFrom(req.query), order);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (format === 'csv') {
    res.write('received,event_time,source_ip,private_ip,host,facility,severity,app,procid,msgid,message\n');
  }

  for (const m of it) {
    let line;
    const priv = privateIp(m.message);
    if (format === 'csv') {
      line = [
        iso(m.ts), iso(m.event_ts), m.source_ip, priv, m.host,
        facilityName(m.facility), severityName(m.severity),
        m.app, m.procid, m.msgid, m.message,
      ].map(csvCell).join(',') + '\n';
    } else if (format === 'json') {
      line = JSON.stringify({
        received: iso(m.ts), event_time: iso(m.event_ts), source_ip: m.source_ip,
        private_ip: priv || null, host: m.host, facility: facilityName(m.facility),
        severity: severityName(m.severity), severity_code: m.severity,
        app: m.app, procid: m.procid, msgid: m.msgid, message: m.message,
      }) + '\n';
    } else {
      const tag = [m.app, m.procid && `[${m.procid}]`].filter(Boolean).join('');
      line = `${iso(m.ts)}  ${severityName(m.severity).padEnd(13)} ${(m.host || m.source_ip || '-')}  ${tag}${tag ? ': ' : ''}${m.message || ''}\n`;
    }
    // Real backpressure: if the socket buffer is full, PAUSE the DB iteration
    // until it drains. Without this, a large export buffers every row in memory
    // and OOM-kills the process (the box has little RAM).
    if (!res.write(line)) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
    if (res.writableEnded || res.destroyed) break; // client disconnected — stop
  }
  res.end();
});

// ---- firewall: manage the UDP 514 allow-list ----
app.get('/api/firewall', requireAuth, async (req, res) => {
  try {
    res.json(await fw.listRules());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/firewall/allow', requireAuth, async (req, res) => {
  try {
    const src = await fw.allowSource((req.body || {}).source, (req.body || {}).name);
    res.json({ ok: true, source: src, ...(await fw.listRules()) });
  } catch (err) {
    res.status(400).json({ error: sanitizeFwError(err) });
  }
});

app.post('/api/firewall/deny', requireAuth, async (req, res) => {
  try {
    const src = await fw.removeSource((req.body || {}).source);
    res.json({ ok: true, source: src, ...(await fw.listRules()) });
  } catch (err) {
    res.status(400).json({ error: sanitizeFwError(err) });
  }
});

function sanitizeFwError(err) {
  const msg = (err.stderr || err.message || '').toString().trim();
  if (/a password is required|sudo:/i.test(msg)) {
    return 'The server is not permitted to run ufw. Add the sudoers rule (see deploy/SETUP.md).';
  }
  return msg || 'Firewall command failed.';
}

// Server-Sent Events live tail.
app.get('/api/stream', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  const onMsg = (row) => {
    // The row still lacks its DB id until flush; send what the client needs.
    res.write(`data: ${JSON.stringify(row)}\n\n`);
  };
  collector.on('message', onMsg);

  const keepalive = setInterval(() => res.write(': ping\n\n'), 25000);
  keepalive.unref();

  req.on('close', () => {
    clearInterval(keepalive);
    collector.removeListener('message', onMsg);
  });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[web] Axus Syslog dashboard on http://127.0.0.1:${PORT}`);
});

// --------------------------- graceful shutdown ---------------------------
function shutdown(sig) {
  console.log(`\n[main] ${sig} — shutting down`);
  collector.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

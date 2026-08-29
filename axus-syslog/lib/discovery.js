'use strict';

// Auto-discovery of syslog sources. Two reliable identifiers are used:
//   • MAC  — a phone/device that logs "Mac: aa:bb:.." (Yealink and many others).
//            Stable across DHCP changes, so it's the preferred device identity.
//   • source_ip — the datagram SENDER address, for a device that never logs a MAC
//            (a switch, server, AP…). This is the real sender, unlike IPs parsed
//            from message bodies (call-ids / SIP peers), which name OTHER parties
//            and would invent phantom devices — so body IPs are never used here.
//
// A brand-new source is alerted on (ntfy + email) and, when auto-register is on,
// turned into a monitored_device so it immediately gets dead-man up/down detection
// with no manual setup. MAC/IP enrichment (extension + endpoint IP) is best-effort
// and only decorates the friendly name.
//
// Design mirrors devices.js: a cheap in-memory hot path on every message; a periodic
// tick() persists sightings and does the (rare) new-source promotion + alerting.

const db = require('./db');
const alerts = require('./alerts');
const devices = require('./devices');

// ---- config (cached; refreshed from DB settings on tick + refresh) ----
let enabledCfg = true;
let autoRegisterCfg = true;
let intervalCfg = 600; // dead-man threshold (sec) for auto-created devices
const GRACE_MS = 120000; // observe a source this long before promoting a source_ip
const INTERVAL_OPTIONS = [120, 300, 600, 900, 1800, 3600];
const startedAt = Date.now(); // so a restart re-learns which senders carry MACs

function loadCfg() {
  const e = db.getSetting('discovery_enabled');
  const a = db.getSetting('discovery_auto_register');
  const i = Number(db.getSetting('discovery_interval_sec'));
  enabledCfg = e == null ? true : e !== '0';
  autoRegisterCfg = a == null ? true : a !== '0';
  intervalCfg = INTERVAL_OPTIONS.includes(i) ? i : 600;
}
function seedCfg() {
  if (db.getSetting('discovery_enabled') == null) db.setSetting('discovery_enabled', '1');
  if (db.getSetting('discovery_auto_register') == null) db.setSetting('discovery_auto_register', '1');
  if (db.getSetting('discovery_interval_sec') == null) db.setSetting('discovery_interval_sec', '600');
}

// ---- in-memory state ----
// key -> { id?, kind, value, label, ext, ip, firstTs, lastTs, count, deviceId,
//          notified, ignored, dirty, isNew }
const sources = new Map();
// session-tag cache to correlate ext/ip with a MAC across sibling Yealink log lines
// ("[N.M]: .. sip:<ext>@<ip>" and "[N.M]: .. Mac: <mac>" are separate lines).
const tagCache = new Map(); // tag -> { ext, ip, mac, ts }
const TAG_TTL_MS = 60000;
const TAG_CAP = 4000;
// datagram sender IPs from which we've EVER seen a MAC — such a sender is already
// covered by MAC-based discovery (e.g. the office NAT all the phones sit behind),
// so it must not also be flagged as its own source_ip device.
const macBearingSrc = new Set();
// lowercased match_values of existing monitored_devices (so we never re-alert a
// device an operator already set up); refreshed on tick.
let deviceMatchVals = [];

// ---- regexes ----
// Require the "Mac:" label so we key on a device's declared MAC, not any hex that
// happens to look like one.
const MAC_RE = /Mac:\s*((?:[0-9a-f]{2}:){5}[0-9a-f]{2})/ig;
// sip:<ext>@<privateIp> — best-effort endpoint identity for the friendly name.
const SIP_EXT_RE = /sip:(\d{2,6})@((?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){1,3})\b/i;
const TAG_RE = /^\[(\d+\.\d+)\]:/;

function isPrivate(ip) {
  const o = String(ip).split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
function isLoopback(ip) { return !ip || ip === '127.0.0.1' || ip === '::1' || String(ip).startsWith('127.'); }

function refresh() {
  loadCfg();
  seedCfg();
  loadCfg();
  sources.clear();
  for (const r of db.listDiscovered()) {
    sources.set(r.key, {
      id: r.id, kind: r.kind, value: r.value, label: r.label,
      ext: r.ext, ip: r.ip, firstTs: r.first_seen_ts, lastTs: r.last_seen_ts,
      count: r.msg_count || 0, deviceId: r.device_id,
      // A row persisted but not yet notified must resume as pending so it can still
      // promote after a restart.
      notified: !!r.notified, ignored: !!r.ignored, dirty: false, isNew: !r.notified,
    });
  }
  refreshDeviceMatchVals();
}
function refreshDeviceMatchVals() {
  try { deviceMatchVals = db.listDevices().map((d) => String(d.match_value || '').toLowerCase()); }
  catch (_) { /* keep previous */ }
}
function alreadyMonitored(valueLc) { return deviceMatchVals.some((mv) => mv.includes(valueLc)); }
function findDeviceIdFor(valueLc) {
  try { for (const d of db.listDevices()) { if (String(d.match_value || '').toLowerCase().includes(valueLc)) return d.id; } }
  catch (_) {}
  return null;
}

function rememberTag(tag, patch) {
  if (!tag) return null;
  let e = tagCache.get(tag);
  if (!e) {
    if (tagCache.size >= TAG_CAP) {
      const cut = Date.now() - TAG_TTL_MS;
      for (const [k, v] of tagCache) { if (v.ts < cut) tagCache.delete(k); }
      if (tagCache.size >= TAG_CAP) { const first = tagCache.keys().next().value; tagCache.delete(first); }
    }
    e = { ext: null, ip: null, mac: null, ts: 0 };
    tagCache.set(tag, e);
  }
  if (patch.ext) e.ext = patch.ext;
  if (patch.ip) e.ip = patch.ip;
  if (patch.mac) e.mac = patch.mac;
  e.ts = Date.now();
  return e;
}

function touch(key, kind, value, meta, now) {
  let s = sources.get(key);
  if (!s) {
    s = {
      kind, value, label: null, ext: meta.ext || null, ip: meta.ip || null,
      firstTs: now, lastTs: now, count: 1, deviceId: null,
      notified: false, ignored: false, dirty: true, isNew: true,
    };
    sources.set(key, s);
    return s;
  }
  s.lastTs = now;
  s.count += 1;
  if (meta.ext && !s.ext) s.ext = meta.ext;
  if (meta.ip && !s.ip) s.ip = meta.ip;
  s.dirty = true;
  return s;
}

// Per-message hot path (called from the collector). Kept cheap.
function observe(row) {
  if (!enabledCfg) return;
  const msg = String((row && row.message) || '');
  const now = Date.now();
  const srcIp = row && row.sourceIp;

  // --- MAC identities (+ best-effort ext/ip enrichment via session tag) ---
  const tag = (msg.match(TAG_RE) || [])[1] || null;
  const sip = msg.match(SIP_EXT_RE);
  let ext = null, sipIp = null;
  if (sip && isPrivate(sip[2])) { ext = sip[1]; sipIp = sip[2]; }

  const macs = [];
  let m;
  MAC_RE.lastIndex = 0;
  while ((m = MAC_RE.exec(msg)) !== null) macs.push(m[1].toLowerCase());

  const tagInfo = tag ? rememberTag(tag, { ext, ip: sipIp, mac: macs[0] || null }) : null;
  const corrExt = ext || (tagInfo && tagInfo.ext) || null;
  const corrIp = sipIp || (tagInfo && tagInfo.ip) || null;

  for (const mac of macs) touch('mac:' + mac, 'mac', mac, { ext: corrExt, ip: corrIp }, now);

  // --- source_ip identity (for non-MAC senders) ---
  if (srcIp && !isLoopback(srcIp)) {
    // A sender that ever carries a MAC is covered by MAC discovery — never flag it
    // as its own device (this auto-excludes the shared office NAT).
    if (macs.length) macBearingSrc.add(srcIp);
    touch('srcip:' + srcIp, 'srcip', srcIp, { ext: null, ip: srcIp }, now);
  }
}

function buildLabel(s) {
  if (s.kind === 'mac') {
    if (s.ext && s.ip) return `Phone ${s.ext} (${s.ip})`;
    if (s.ext) return `Phone ${s.ext}`;
    return `Device ${s.value}` + (s.ip ? ` (${s.ip})` : '');
  }
  return `Sender ${s.value}`; // source_ip device
}

function autoRegister(s) {
  const label = s.label || buildLabel(s);
  const d = db.createDevice({
    name: label,
    matchType: s.kind === 'srcip' ? 'source_ip' : 'contains',
    matchValue: s.value,
    intervalSec: intervalCfg,
    enabled: true,
  });
  s.deviceId = d.id;
  devices.refresh(); // pull the new device into the dead-man hot path
  return d;
}

function announce(s, registered) {
  const label = s.label || buildLabel(s);
  const idkind = s.kind === 'mac' ? 'MAC ' + s.value : 'IP ' + s.value;
  alerts.notifyAll({
    title: `New syslog source: ${label}`,
    body: registered
      ? `A new device (${idkind}) started sending syslog and was auto-registered for offline monitoring ` +
        `(alerts if it goes quiet for ${Math.round(intervalCfg / 60)} min). First seen ${new Date(s.firstTs).toISOString()}.`
      : `A new device (${idkind}) started sending syslog. Not yet monitored — open the Discovery tab to add it. ` +
        `First seen ${new Date(s.firstTs).toISOString()}.`,
    tags: 'satellite_antenna',
    priority: 'default',
  });
}

// Periodic: persist sightings and promote/alert brand-new sources. Never throws.
function tick() {
  loadCfg();
  refreshDeviceMatchVals();
  const now = Date.now();
  const observedLongEnough = now - startedAt >= GRACE_MS;

  for (const [key, s] of sources) {
    if (s.isNew && !s.notified && !s.ignored) {
      const valueLc = String(s.value).toLowerCase();
      let promote = false;

      if (s.kind === 'mac') {
        promote = true; // a MAC is a device identity — safe to register at once
      } else if (s.kind === 'srcip') {
        // fold a sender we've learned carries MACs (it's covered by MAC discovery)
        if (macBearingSrc.has(s.value)) { s.ignored = true; s.dirty = true; }
        // otherwise wait out the grace AND enough uptime to have learned its nature
        else if (now - s.firstTs >= GRACE_MS && observedLongEnough) promote = true;
      }

      if (promote && !s.ignored) {
        s.label = buildLabel(s);
        if (alreadyMonitored(valueLc)) {
          s.deviceId = findDeviceIdFor(valueLc); // link to the operator's device, no alert
          s.notified = true;
        } else {
          try {
            if (autoRegisterCfg) { autoRegister(s); announce(s, true); }
            else { announce(s, false); }
          } catch (err) { console.error('[discovery] promote error:', err.message); }
          s.notified = true;
        }
        s.isNew = false;
        s.dirty = true;
      }
    }

    if (s.dirty) {
      try {
        const row = db.upsertDiscovered({
          key, kind: s.kind, value: s.value, label: s.label,
          ext: s.ext, ip: s.ip, firstTs: s.firstTs, lastTs: s.lastTs,
          count: s.count, deviceId: s.deviceId, notified: s.notified, ignored: s.ignored,
        });
        if (row && s.id == null) s.id = row.id;
        s.dirty = false;
      } catch (err) { console.error('[discovery] persist error:', err.message); }
    }
  }
}

// Discovery list for the dashboard, decorated with live monitored-device state.
function statusList() {
  const devState = new Map();
  try { for (const d of devices.statusList()) devState.set(d.id, d); } catch (_) {}
  const out = [];
  for (const [key, s] of sources) {
    if (s.ignored) continue;
    const dev = s.deviceId != null ? devState.get(s.deviceId) : null;
    const quietSec = s.lastTs != null ? Math.round((Date.now() - s.lastTs) / 1000) : null;
    out.push({
      id: s.id != null ? s.id : null,
      key, kind: s.kind, value: s.value,
      label: s.label || buildLabel(s),
      ext: s.ext || null, ip: s.ip || null,
      firstSeenTs: s.firstTs || null, lastSeenTs: s.lastTs || null, quietSec,
      count: s.count || 0,
      monitored: s.deviceId != null,
      deviceId: s.deviceId != null ? s.deviceId : null,
      deviceState: dev ? dev.state : null,
    });
  }
  out.sort((a, b) => (b.lastSeenTs || 0) - (a.lastSeenTs || 0));
  return out;
}

function settings() {
  return { enabled: enabledCfg, autoRegister: autoRegisterCfg, intervalSec: intervalCfg, options: INTERVAL_OPTIONS };
}
function setSettings(patch) {
  if (typeof patch.enabled === 'boolean') db.setSetting('discovery_enabled', patch.enabled ? '1' : '0');
  if (typeof patch.autoRegister === 'boolean') db.setSetting('discovery_auto_register', patch.autoRegister ? '1' : '0');
  if (patch.intervalSec != null) {
    const v = Number(patch.intervalSec);
    if (!INTERVAL_OPTIONS.includes(v)) return { error: 'Invalid interval.' };
    db.setSetting('discovery_interval_sec', String(v));
  }
  loadCfg();
  return settings();
}

// Manually register a discovered-but-unmonitored source as a monitored device.
function adopt(id) {
  const s = findById(id);
  if (!s) return { error: 'Source not found.' };
  if (s.deviceId != null) return { error: 'Already monitored.' };
  s.label = s.label || buildLabel(s);
  try {
    const d = autoRegister(s);
    s.notified = true; s.dirty = true;
    tick();
    return { ok: true, deviceId: d.id };
  } catch (err) { return { error: err.message }; }
}

// Dismiss a source: hide it and don't re-alert. Does NOT delete a linked device.
function forget(id) {
  const s = findById(id);
  if (!s) return { error: 'Source not found.' };
  s.ignored = true; s.isNew = false; s.notified = true; s.dirty = true;
  try { tick(); } catch (_) {}
  return { ok: true };
}
function findById(id) {
  const n = Number(id);
  for (const s of sources.values()) if (s.id === n) return s;
  return null;
}

module.exports = {
  refresh, observe, tick, statusList, settings, setSettings, adopt, forget,
  INTERVAL_OPTIONS,
};

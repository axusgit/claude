'use strict';

// Monitored-device dead-man detection. Each configured device has a match rule
// (source_ip / host / contains) and an expected max gap (interval_sec). We stamp a
// last-seen time whenever a matching message arrives; a periodic tick marks a
// device offline when it goes quiet past its threshold (and back online when it
// resumes), firing an alert to ntfy + email on each transition.
//
// Runtime last-seen lives in memory for cheap per-message updates and is persisted
// on every tick so a service restart preserves the clock and the already-notified
// down state (no reset, no duplicate alert).

const db = require('./db');
const alerts = require('./alerts');

// id -> { lastSeen: ms|null }  (in-memory hot path)
const runtime = new Map();
// Compiled snapshot of enabled devices for the ingest hot path.
let compiled = [];

function compile(devices) {
  compiled = devices
    .filter((d) => d.enabled)
    .map((d) => ({
      id: d.id,
      type: d.match_type,
      value: d.match_value,
      valueLc: String(d.match_value || '').toLowerCase(),
    }));
}

// (Re)load device list from the DB and refresh the in-memory runtime map. Called
// at startup and after any create/update/delete so the hot path stays current.
function refresh() {
  const devices = db.listDevices();
  const now = Date.now();
  const nextRuntime = new Map();
  for (const d of devices) {
    const prev = runtime.get(d.id);
    // Prefer a live in-memory last-seen; else the persisted one; else seed to now
    // (grace for a brand-new device so it isn't instantly flagged offline).
    let lastSeen = prev ? prev.lastSeen : (d.last_seen_ts != null ? d.last_seen_ts : now);
    nextRuntime.set(d.id, { lastSeen });
  }
  runtime.clear();
  for (const [k, v] of nextRuntime) runtime.set(k, v);
  compile(devices);
}

function matches(dev, row, hayLc) {
  if (dev.type === 'source_ip') return (row.sourceIp || '') === dev.value;
  if (dev.type === 'host') return (row.host || '') === dev.value;
  // contains (default): case-insensitive substring over the message + metadata.
  return hayLc.includes(dev.valueLc);
}

// Per-message hook (called from the collector). Stamps last-seen for every device
// whose rule matches. Kept cheap: the haystack is built once and only if needed.
function observe(row) {
  if (compiled.length === 0) return;
  let hayLc = null;
  const needHay = compiled.some((d) => d.type === 'contains');
  if (needHay) {
    hayLc = `${row.message || ''} ${row.host || ''} ${row.app || ''} ${row.sourceIp || ''}`.toLowerCase();
  }
  const now = Date.now();
  for (const dev of compiled) {
    if (matches(dev, row, hayLc)) {
      const rt = runtime.get(dev.id);
      if (rt) rt.lastSeen = now;
      else runtime.set(dev.id, { lastSeen: now });
    }
  }
}

// Periodic evaluation: persist last-seen, and fire down/recovery alerts on state
// transitions. Safe to call on an interval; never throws.
function tick() {
  let devices;
  try { devices = db.listDevices(); } catch (err) { console.error('[devices] tick load error:', err.message); return; }
  const now = Date.now();
  for (const d of devices) {
    const rt = runtime.get(d.id) || { lastSeen: d.last_seen_ts };
    if (!runtime.has(d.id)) runtime.set(d.id, rt);
    const lastSeen = rt.lastSeen;

    if (!d.enabled) {
      // Keep the clock current but don't evaluate/alert while disabled.
      try { db.saveDeviceState(d.id, { lastSeenTs: lastSeen, state: 'unknown', downNotified: 0 }); } catch (_) {}
      continue;
    }

    const quietMs = lastSeen != null ? now - lastSeen : Infinity;
    const isDown = quietMs > d.interval_sec * 1000;
    let state = d.state;
    let downNotified = d.down_notified;

    if (isDown && !d.down_notified) {
      state = 'down';
      downNotified = 1;
      try { alerts.deviceAlert(d, { down: true, quietSec: Math.round(quietMs / 1000) }); } catch (err) { console.error('[devices] alert error:', err.message); }
      console.error(`[devices] DOWN: ${d.name} (quiet ${Math.round(quietMs / 1000)}s > ${d.interval_sec}s)`);
    } else if (!isDown && (d.state === 'down' || d.down_notified)) {
      state = 'up';
      downNotified = 0;
      try { alerts.deviceAlert(d, { down: false }); } catch (err) { console.error('[devices] alert error:', err.message); }
      console.log(`[devices] UP: ${d.name} — syslog resumed`);
    } else {
      state = isDown ? 'down' : (lastSeen != null ? 'up' : 'unknown');
    }

    try { db.saveDeviceState(d.id, { lastSeenTs: lastSeen, state, downNotified }); } catch (_) {}
  }
}

// Device list decorated with live runtime status for the dashboard.
function statusList() {
  const now = Date.now();
  return db.listDevices().map((d) => {
    const rt = runtime.get(d.id);
    const lastSeen = rt ? rt.lastSeen : d.last_seen_ts;
    const quietSec = lastSeen != null ? Math.round((now - lastSeen) / 1000) : null;
    let state = d.state;
    if (d.enabled) {
      if (lastSeen == null) state = 'unknown';
      else state = quietSec > d.interval_sec ? 'down' : 'up';
    } else {
      state = 'disabled';
    }
    return {
      id: d.id,
      name: d.name,
      matchType: d.match_type,
      matchValue: d.match_value,
      intervalSec: d.interval_sec,
      enabled: !!d.enabled,
      lastSeenTs: lastSeen || null,
      quietSec,
      state,
    };
  });
}

module.exports = { refresh, observe, tick, statusList };

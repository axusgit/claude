'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// SQLite store for syslog messages. Inserts are buffered and flushed in a single
// transaction on a short interval, so a burst of UDP packets doesn't turn into a
// storm of individual disk writes.

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'syslog.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
// The table is multi-GB (millions of rows). Without these, every dashboard
// aggregate re-reads pages from disk via pread syscalls and the small default
// cache thrashes — making stats/host queries take many seconds. mmap lets SQLite
// read the file straight from the OS page cache; the larger cache keeps hot
// index/data pages resident. Both are per-connection and must be set on open.
db.pragma('mmap_size = 1073741824'); // 1 GB memory-mapped I/O
db.pragma('cache_size = -131072');   // 128 MB page cache (negative = KiB)

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,      -- received time (ms epoch)
  event_ts  INTEGER,              -- timestamp parsed from the message, if any
  source_ip TEXT,
  host      TEXT,
  facility  INTEGER,
  severity  INTEGER,
  app       TEXT,
  procid    TEXT,
  msgid     TEXT,
  message   TEXT,
  raw       TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_ts       ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_msg_host     ON messages(host);
CREATE INDEX IF NOT EXISTS idx_msg_severity ON messages(severity);
CREATE INDEX IF NOT EXISTS idx_msg_source   ON messages(source_ip);
CREATE INDEX IF NOT EXISTS idx_msg_facility ON messages(facility);
-- Covering index for the "top hosts in the last 24h" widget: lets the GROUP BY
-- run as an index-only range scan (ts>=cutoff) instead of touching millions of
-- rows to read host/source_ip. Cuts that query from ~8s to ~1s.
CREATE INDEX IF NOT EXISTS idx_msg_ts_host_src ON messages(ts, host, source_ip);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Distinct sources/hosts, maintained incrementally so the filter dropdowns don't
-- need a full-table DISTINCT scan (which was ~16s at 5M+ rows). Upserted on every
-- flush; stale entries pruned alongside message retention.
CREATE TABLE IF NOT EXISTS sources (
  name    TEXT PRIMARY KEY,
  last_ts INTEGER
);

-- Monitored devices: per-device dead-man detection. Each device is matched against
-- incoming messages by a rule (source_ip / host / contains); if no matching message
-- arrives within interval_sec, it's considered offline and an alert fires (with a
-- recovery alert when it returns). last_seen_ts + state are persisted so a service
-- restart doesn't reset the clock or re-fire an already-notified down state.
CREATE TABLE IF NOT EXISTS monitored_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  match_type    TEXT NOT NULL DEFAULT 'contains',  -- 'source_ip' | 'host' | 'contains'
  match_value   TEXT NOT NULL,
  interval_sec  INTEGER NOT NULL DEFAULT 300,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_seen_ts  INTEGER,
  state         TEXT NOT NULL DEFAULT 'unknown',   -- 'up' | 'down' | 'unknown'
  down_notified INTEGER NOT NULL DEFAULT 0,
  created_ts    INTEGER
);

-- Auto-discovery: stable per-device identifiers (MAC / endpoint IP) seen in the
-- stream. A brand-new source is alerted on and (optionally) auto-registered as a
-- monitored_device so it gets dead-man up/down detection with no manual setup.
-- 'notified' prevents re-alerting across restarts; 'device_id' links the created
-- monitored device; 'ignored' lets an operator dismiss a source for good.
CREATE TABLE IF NOT EXISTS discovered_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,     -- 'mac:aa:bb:..' | 'ip:192.168.x.y'
  kind          TEXT NOT NULL,            -- 'mac' | 'ip'
  value         TEXT NOT NULL,            -- the mac or ip
  label         TEXT,                     -- friendly, e.g. 'Phone 4050 (192.168.19.175)'
  ext           TEXT,                     -- correlated extension, best-effort
  ip            TEXT,                     -- correlated endpoint IP, best-effort
  first_seen_ts INTEGER,
  last_seen_ts  INTEGER,
  msg_count     INTEGER NOT NULL DEFAULT 0,
  device_id     INTEGER,                  -- monitored_devices.id if registered
  notified      INTEGER NOT NULL DEFAULT 0,
  ignored       INTEGER NOT NULL DEFAULT 0
);
`);

// Separate READ-ONLY connection used only for long-running streamed exports.
// better-sqlite3 is one-statement-per-connection: an open export cursor makes the
// whole connection "busy", so streaming a large export off the MAIN connection
// blocks every insert-flush and retention prune for the entire download (minutes,
// for a mult-hundred-MB CSV). In WAL mode a second connection reads a consistent
// snapshot concurrently while the main connection keeps writing — so exports can
// never stall ingest. Writes still go only through `db`.
const dbRead = new Database(DB_PATH, { readonly: true });
dbRead.pragma('mmap_size = 1073741824');
dbRead.pragma('cache_size = -131072');

// --- key/value settings (retention, etc.) ---
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

const insertStmt = db.prepare(`
  INSERT INTO messages
    (ts, event_ts, source_ip, host, facility, severity, app, procid, msgid, message, raw)
  VALUES
    (@ts, @eventTs, @sourceIp, @host, @facility, @severity, @app, @procid, @msgid, @message, @raw)
`);

// Keep the `sources` lookup table current as rows land. COALESCE(host, source_ip)
// mirrors what the dropdowns show; we bump last_ts so retention can drop sources
// that no longer have any messages.
const upsertSourceStmt = db.prepare(`
  INSERT INTO sources(name, last_ts) VALUES(@name, @ts)
  ON CONFLICT(name) DO UPDATE SET last_ts = excluded.last_ts
  WHERE excluded.last_ts > sources.last_ts
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) {
    insertStmt.run(r);
    const name = r.host || r.sourceIp;
    if (name) upsertSourceStmt.run({ name, ts: r.ts });
  }
});

// One-time backfill: if the sources table is empty but messages exist (first run
// after this feature ships), populate it from the existing data.
function backfillSources() {
  const have = db.prepare('SELECT 1 FROM sources LIMIT 1').get();
  if (have) return;
  const anyMsg = db.prepare('SELECT 1 FROM messages LIMIT 1').get();
  if (!anyMsg) return;
  db.prepare(`
    INSERT OR IGNORE INTO sources(name, last_ts)
    SELECT COALESCE(host, source_ip) AS name, MAX(ts)
    FROM messages
    WHERE COALESCE(host, source_ip) IS NOT NULL
    GROUP BY name
  `).run();
}
backfillSources();

let buffer = [];

// Queue a parsed message for the next flush.
function enqueue(row) {
  buffer.push(row);
}

// Flush the buffer. Returns the number of rows written.
function flush() {
  if (buffer.length === 0) return 0;
  const rows = buffer;
  buffer = [];
  insertMany(rows);
  return rows.length;
}

// Build a shared WHERE clause + bound params from filter options.
//   host, sourceIp, app, q (text LIKE), facility (int), maxSeverity (int),
//   since (ms), until (ms), afterId (int)
function buildFilter(opts = {}) {
  const where = [];
  const params = {};
  if (opts.host) { where.push('host = @host'); params.host = opts.host; }
  if (opts.sourceIp) { where.push('source_ip = @sourceIp'); params.sourceIp = opts.sourceIp; }
  if (opts.app) { where.push('app = @app'); params.app = opts.app; }
  if (opts.facility != null && opts.facility !== '') {
    where.push('facility = @facility'); params.facility = Number(opts.facility);
  }
  if (opts.maxSeverity != null && opts.maxSeverity !== '') {
    where.push('severity <= @maxSeverity'); params.maxSeverity = Number(opts.maxSeverity);
  }
  if (opts.q) {
    where.push('(message LIKE @q OR host LIKE @q OR app LIKE @q OR source_ip LIKE @q)');
    params.q = `%${opts.q}%`;
  }
  if (opts.since) { where.push('ts >= @since'); params.since = Number(opts.since); }
  if (opts.until) { where.push('ts <= @until'); params.until = Number(opts.until); }
  if (opts.afterId) { where.push('id > @afterId'); params.afterId = Number(opts.afterId); }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Query with filters (paged). Returns { rows, total }.
function query(opts = {}) {
  const { clause, params } = buildFilter(opts);
  const order = opts.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const total = db.prepare(`SELECT COUNT(*) AS c FROM messages ${clause}`).get(params).c;
  const rows = db
    .prepare(`SELECT * FROM messages ${clause} ORDER BY id ${order} LIMIT ${limit} OFFSET ${offset}`)
    .all(params);
  return { rows, total };
}

// Streaming iterator over ALL rows matching the filters (no page cap) — for
// exports. `order` is 'asc' (oldest first, natural for a log file) or 'desc'.
// Returns a better-sqlite3 statement iterator; caller consumes lazily.
function iterate(opts = {}, order = 'asc') {
  const { clause, params } = buildFilter(opts);
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  // Runs on the dedicated read-only connection so a long export never holds the
  // main connection's cursor (which would block ingest flushes + retention).
  return dbRead
    .prepare(`SELECT * FROM messages ${clause} ORDER BY id ${dir}`)
    .iterate(params);
}

// Complete UTC days (older than cutoffMs) that still have rows — for archiving.
// Returns [{ day: 'YYYY-MM-DD', count, startMs, endMs }] oldest-first.
function archivableDays(cutoffMs) {
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch') AS day, COUNT(*) AS c
       FROM messages WHERE ts < @cutoff GROUP BY day ORDER BY day ASC`
    )
    .all({ cutoff: Number(cutoffMs) });
  return rows.map((r) => {
    const [y, m, d] = r.day.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, d);
    return { day: r.day, count: r.c, startMs, endMs: startMs + 86400000 };
  });
}

// Delete rows in [startMs, endMs). Returns rows deleted. Used after a day is
// safely uploaded to the archive.
function deleteRange(startMs, endMs) {
  const n = db
    .prepare('DELETE FROM messages WHERE ts >= ? AND ts < ?')
    .run(Number(startMs), Number(endMs)).changes;
  if (n > 0) db.pragma('wal_checkpoint(TRUNCATE)');
  return n;
}

function stats() {
  const now = Date.now();
  const dayAgo = now - 86400000;
  const hourAgo = now - 3600000;
  const total = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  const last24 = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE ts >= ?').get(dayAgo).c;
  const lastHour = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE ts >= ?').get(hourAgo).c;
  const bySeverity = db
    .prepare('SELECT severity, COUNT(*) AS c FROM messages GROUP BY severity ORDER BY severity')
    .all();
  const topHosts = db
    .prepare(`SELECT COALESCE(host, source_ip) AS name, COUNT(*) AS c
              FROM messages WHERE ts >= ? GROUP BY name ORDER BY c DESC LIMIT 8`)
    .all(dayAgo);
  const oldest = db.prepare('SELECT MIN(ts) AS t FROM messages').get().t;
  return { total, last24, lastHour, bySeverity, topHosts, oldest };
}

// Distinct sources/hosts for the filter dropdowns — served from the maintained
// `sources` table (tiny) instead of a full-table DISTINCT scan over every message.
function facets() {
  const hosts = db
    .prepare('SELECT name FROM sources WHERE name IS NOT NULL ORDER BY name LIMIT 500')
    .all()
    .map((r) => r.name);
  return { hosts };
}

// Enforce retention: drop rows older than the retention age, then trim to maxRows.
// Age can be given as retentionMs (preferred, ms) or retentionDays. Returns the
// number of rows deleted.
function prune({ retentionDays = 0, retentionMs = 0, maxRows = 0 } = {}) {
  let deleted = 0;
  const ageMs = retentionMs > 0 ? retentionMs : (retentionDays > 0 ? retentionDays * 86400000 : 0);
  if (ageMs > 0) {
    const cutoff = Date.now() - ageMs;
    deleted += db.prepare('DELETE FROM messages WHERE ts < ?').run(cutoff).changes;
  }
  if (maxRows > 0) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
    if (count > maxRows) {
      const excess = count - maxRows;
      deleted += db
        .prepare('DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY id ASC LIMIT ?)')
        .run(excess).changes;
    }
  }
  if (deleted > 0) {
    // Drop sources whose newest message has now aged out, so the dropdown doesn't
    // accumulate hosts that no longer have any logs. (Cheap: `sources` is small.)
    const oldest = db.prepare('SELECT MIN(ts) AS t FROM messages').get().t;
    if (oldest != null) db.prepare('DELETE FROM sources WHERE last_ts < ?').run(oldest);
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  return deleted;
}

// --- monitored devices (per-device dead-man) ---
function listDevices() {
  return db.prepare('SELECT * FROM monitored_devices ORDER BY id ASC').all();
}
function getDevice(id) {
  return db.prepare('SELECT * FROM monitored_devices WHERE id = ?').get(Number(id));
}
function createDevice({ name, matchType, matchValue, intervalSec, enabled }) {
  const info = db.prepare(`
    INSERT INTO monitored_devices(name, match_type, match_value, interval_sec, enabled, state, created_ts)
    VALUES(@name, @matchType, @matchValue, @intervalSec, @enabled, 'unknown', @now)
  `).run({
    name, matchType, matchValue,
    intervalSec: Number(intervalSec) || 300,
    enabled: enabled ? 1 : 0,
    now: Date.now(),
  });
  return getDevice(info.lastInsertRowid);
}
function updateDevice(id, fields) {
  const cur = getDevice(id);
  if (!cur) return null;
  const merged = {
    name: fields.name != null ? fields.name : cur.name,
    match_type: fields.matchType != null ? fields.matchType : cur.match_type,
    match_value: fields.matchValue != null ? fields.matchValue : cur.match_value,
    interval_sec: fields.intervalSec != null ? Number(fields.intervalSec) : cur.interval_sec,
    enabled: fields.enabled != null ? (fields.enabled ? 1 : 0) : cur.enabled,
  };
  db.prepare(`
    UPDATE monitored_devices
    SET name=@name, match_type=@match_type, match_value=@match_value,
        interval_sec=@interval_sec, enabled=@enabled
    WHERE id=@id
  `).run({ ...merged, id: Number(id) });
  return getDevice(id);
}
function deleteDevice(id) {
  return db.prepare('DELETE FROM monitored_devices WHERE id = ?').run(Number(id)).changes;
}
// Persist runtime state (last_seen_ts / state / down_notified) for one device.
function saveDeviceState(id, { lastSeenTs, state, downNotified }) {
  db.prepare(`
    UPDATE monitored_devices
    SET last_seen_ts=@lastSeenTs, state=@state, down_notified=@downNotified
    WHERE id=@id
  `).run({
    id: Number(id),
    lastSeenTs: lastSeenTs != null ? Number(lastSeenTs) : null,
    state: state || 'unknown',
    downNotified: downNotified ? 1 : 0,
  });
}

// --- discovered sources (auto-discovery) ---
function listDiscovered() {
  return db.prepare('SELECT * FROM discovered_sources ORDER BY last_seen_ts DESC').all();
}
function upsertDiscovered(s) {
  // Insert a new source or refresh an existing one's sighting/enrichment fields.
  // Returns the row. Keyed on the unique `key`.
  db.prepare(`
    INSERT INTO discovered_sources
      (key, kind, value, label, ext, ip, first_seen_ts, last_seen_ts, msg_count, device_id, notified, ignored)
    VALUES
      (@key, @kind, @value, @label, @ext, @ip, @firstTs, @lastTs, @count, @deviceId, @notified, @ignored)
    ON CONFLICT(key) DO UPDATE SET
      last_seen_ts = excluded.last_seen_ts,
      msg_count    = excluded.msg_count,
      label        = COALESCE(excluded.label, discovered_sources.label),
      ext          = COALESCE(excluded.ext,   discovered_sources.ext),
      ip           = COALESCE(excluded.ip,    discovered_sources.ip),
      device_id    = COALESCE(excluded.device_id, discovered_sources.device_id),
      notified     = MAX(excluded.notified, discovered_sources.notified),
      ignored      = MAX(excluded.ignored,  discovered_sources.ignored)
  `).run({
    key: s.key, kind: s.kind, value: s.value,
    label: s.label != null ? s.label : null,
    ext: s.ext != null ? s.ext : null,
    ip: s.ip != null ? s.ip : null,
    firstTs: s.firstTs != null ? Number(s.firstTs) : null,
    lastTs: s.lastTs != null ? Number(s.lastTs) : null,
    count: Number(s.count) || 0,
    deviceId: s.deviceId != null ? Number(s.deviceId) : null,
    notified: s.notified ? 1 : 0,
    ignored: s.ignored ? 1 : 0,
  });
  return db.prepare('SELECT * FROM discovered_sources WHERE key = ?').get(s.key);
}
function setDiscoveredFields(id, fields) {
  const cur = db.prepare('SELECT * FROM discovered_sources WHERE id = ?').get(Number(id));
  if (!cur) return null;
  const m = {
    label: fields.label != null ? fields.label : cur.label,
    ext: fields.ext != null ? fields.ext : cur.ext,
    ip: fields.ip != null ? fields.ip : cur.ip,
    device_id: fields.deviceId !== undefined ? (fields.deviceId != null ? Number(fields.deviceId) : null) : cur.device_id,
    notified: fields.notified != null ? (fields.notified ? 1 : 0) : cur.notified,
    ignored: fields.ignored != null ? (fields.ignored ? 1 : 0) : cur.ignored,
  };
  db.prepare(`
    UPDATE discovered_sources
    SET label=@label, ext=@ext, ip=@ip, device_id=@device_id, notified=@notified, ignored=@ignored
    WHERE id=@id
  `).run({ ...m, id: Number(id) });
  return db.prepare('SELECT * FROM discovered_sources WHERE id = ?').get(Number(id));
}
function deleteDiscovered(id) {
  return db.prepare('DELETE FROM discovered_sources WHERE id = ?').run(Number(id)).changes;
}

// Total on-disk size of the log store (main DB + WAL + shared-memory files).
function dbSize() {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += fs.statSync(DB_PATH + suffix).size; } catch (_) { /* missing = 0 */ }
  }
  return total;
}

module.exports = {
  db,
  enqueue,
  flush,
  query,
  iterate,
  stats,
  facets,
  prune,
  dbSize,
  getSetting,
  setSetting,
  archivableDays,
  deleteRange,
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  saveDeviceState,
  listDiscovered,
  upsertDiscovered,
  setDiscoveredFields,
  deleteDiscovered,
  DB_PATH,
};

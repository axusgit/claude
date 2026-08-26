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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

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

const insertMany = db.transaction((rows) => {
  for (const r of rows) insertStmt.run(r);
});

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
  return db
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

// Distinct sources/hosts for the filter dropdowns.
function facets() {
  const hosts = db
    .prepare(`SELECT DISTINCT COALESCE(host, source_ip) AS name FROM messages
              WHERE name IS NOT NULL ORDER BY name LIMIT 500`)
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
  if (deleted > 0) db.pragma('wal_checkpoint(TRUNCATE)');
  return deleted;
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
  DB_PATH,
};

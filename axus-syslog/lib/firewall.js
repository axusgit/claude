'use strict';

const { execFile } = require('child_process');

// Manage the ufw allow-list for the syslog ingest port (UDP 514) from the web UI.
//
// Safety model:
//  - Every ufw call goes through execFile('sudo', ['ufw', ...args]) — NO shell,
//    so nothing the user types is ever interpreted by a shell.
//  - Sources are strictly validated as IPv4/IPv6 addresses or CIDRs before use.
//  - The box grants ubuntu passwordless sudo for the ufw binary only
//    (/etc/sudoers.d/axus-syslog); see deploy/SETUP.md.

const PORT = String(process.env.SYSLOG_UDP_PORT || 514);
const DEFAULT_COMMENT = 'Axus Syslog (GUI)';

// ufw stores the comment in its rules file; keep it to a safe, printable set and
// a sane length so it can't break rule parsing. Falls back to a default label.
function sanitizeComment(name) {
  const s = String(name == null ? '' : name)
    .replace(/[^A-Za-z0-9 _.\-/@()#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return s || DEFAULT_COMMENT;
}

// --- validation ------------------------------------------------------------

function isValidIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255 && String(Number(o)) === o);
}

function isValidIPv6(s) {
  // Pragmatic IPv6 check: hex groups and at most one "::" collapse.
  if (!/^[0-9a-fA-F:]+$/.test(s)) return false;
  if ((s.match(/::/g) || []).length > 1) return false;
  const parts = s.split(':');
  if (parts.length > 8) return false;
  return parts.every((p) => p === '' || /^[0-9a-fA-F]{1,4}$/.test(p));
}

// Returns a normalized source string ("any" or "ip[/mask]") or null if invalid.
function normalizeSource(input) {
  const s = String(input || '').trim();
  if (!s || s.toLowerCase() === 'any' || s.toLowerCase() === 'anywhere') return 'any';
  const [addr, mask, ...extra] = s.split('/');
  if (extra.length) return null;
  let maxMask;
  if (isValidIPv4(addr)) maxMask = 32;
  else if (isValidIPv6(addr)) maxMask = 128;
  else return null;
  if (mask !== undefined) {
    if (!/^\d{1,3}$/.test(mask)) return null;
    const n = Number(mask);
    if (n < 0 || n > maxMask) return null;
    return `${addr}/${n}`;
  }
  return addr;
}

// --- ufw helpers -----------------------------------------------------------

function ufw(args) {
  return new Promise((resolve, reject) => {
    execFile('sudo', ['ufw', ...args], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve(String(stdout));
    });
  });
}

// Parse `ufw status` and return only the rules that concern our syslog port.
async function listRules() {
  let out;
  try {
    out = await ufw(['status']);
  } catch (err) {
    return { active: false, rules: [], error: (err.stderr || err.message || '').trim() };
  }
  const active = /Status:\s*active/i.test(out);
  const rules = [];
  for (const line of out.split('\n')) {
    // Match the "To" column starting with our port, e.g. "514/udp" or "514/udp (v6)".
    const m = /^(\d+)\/udp(\s+\(v6\))?\s+(ALLOW|DENY|REJECT|LIMIT)\s+(?:IN\s+)?(.+?)\s*(?:#\s*(.*))?$/.exec(line.trim());
    if (!m) continue;
    if (m[1] !== PORT) continue;
    rules.push({
      v6: !!m[2],
      action: m[3],
      source: m[4].trim(),
      comment: (m[5] || '').trim(),
    });
  }
  return { active, rules };
}

// Allow inbound UDP 514 from a source (IP/CIDR, or "any"), labelled with a name.
async function allowSource(input, name) {
  const src = normalizeSource(input);
  if (!src) throw new Error('Invalid IP address or CIDR.');
  const comment = sanitizeComment(name);
  const args =
    src === 'any'
      ? ['allow', `${PORT}/udp`, 'comment', comment]
      : ['allow', 'from', src, 'to', 'any', 'port', PORT, 'proto', 'udp', 'comment', comment];
  await ufw(args);
  return src;
}

// Remove a previously-added allow rule for UDP 514 from a source.
async function removeSource(input) {
  const src = normalizeSource(input);
  if (!src) throw new Error('Invalid IP address or CIDR.');
  const args =
    src === 'any'
      ? ['delete', 'allow', `${PORT}/udp`]
      : ['delete', 'allow', 'from', src, 'to', 'any', 'port', PORT, 'proto', 'udp'];
  await ufw(args);
  return src;
}

module.exports = { listRules, allowSource, removeSource, normalizeSource, PORT };

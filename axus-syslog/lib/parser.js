'use strict';

// Parse syslog messages (RFC 3164 "BSD" and RFC 5424) into a common shape.
// Everything is best-effort: a line that doesn't match a known format is still
// stored, as a plain message with default facility/severity, so nothing is lost.

const SEVERITIES = [
  'Emergency',
  'Alert',
  'Critical',
  'Error',
  'Warning',
  'Notice',
  'Informational',
  'Debug',
];

const FACILITIES = [
  'kern',
  'user',
  'mail',
  'daemon',
  'auth',
  'syslog',
  'lpr',
  'news',
  'uucp',
  'cron',
  'authpriv',
  'ftp',
  'ntp',
  'security',
  'console',
  'solaris-cron',
  'local0',
  'local1',
  'local2',
  'local3',
  'local4',
  'local5',
  'local6',
  'local7',
];

function severityName(s) {
  return SEVERITIES[s] != null ? SEVERITIES[s] : String(s);
}

function facilityName(f) {
  return FACILITIES[f] != null ? FACILITIES[f] : String(f);
}

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// RFC 3164 timestamp: "Mmm dd hh:mm:ss" (no year). Assume current year, and if
// that lands in the future (year-boundary skew), roll back a year.
function parse3164Time(str, now) {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (mon == null) return null;
  const nowD = new Date(now);
  let year = nowD.getFullYear();
  let t = new Date(year, mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  if (t.getTime() - now > 86400000) {
    year -= 1;
    t = new Date(year, mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  }
  return t.getTime();
}

// Decode the <PRI> at the head of a message. Returns { facility, severity, rest }
// or null if there's no valid PRI.
function decodePri(s) {
  const m = /^<(\d{1,3})>/.exec(s);
  if (!m) return null;
  const pri = Number(m[1]);
  if (pri > 191) return null; // max valid PRI = 23*8 + 7
  return {
    facility: pri >> 3,
    severity: pri & 7,
    rest: s.slice(m[0].length),
  };
}

// Main entry. `raw` is the packet string; `sourceIp` the sender; `now` ms epoch.
function parse(raw, sourceIp, now) {
  const text = String(raw).replace(/\0+$/, '').replace(/\r?\n$/, '');
  const out = {
    ts: now,
    eventTs: null,
    sourceIp: sourceIp || null,
    host: null,
    facility: 1, // user
    severity: 5, // notice
    app: null,
    procid: null,
    msgid: null,
    message: text,
    raw: text,
  };

  const pri = decodePri(text);
  if (!pri) {
    // No PRI at all — keep as-is with defaults.
    return out;
  }
  out.facility = pri.facility;
  out.severity = pri.severity;
  let rest = pri.rest;

  // RFC 5424: "<PRI>VERSION SP TIMESTAMP SP HOST SP APP SP PROCID SP MSGID ..."
  // VERSION is a digit immediately after '>' (usually "1").
  const v5424 = /^(\d)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/s.exec(rest);
  if (v5424 && v5424[1] === '1') {
    const [, , tstamp, host, app, procid, msgid, tail] = v5424;
    out.host = host === '-' ? null : host;
    out.app = app === '-' ? null : app;
    out.procid = procid === '-' ? null : procid;
    out.msgid = msgid === '-' ? null : msgid;
    if (tstamp !== '-') {
      const t = Date.parse(tstamp);
      if (!Number.isNaN(t)) out.eventTs = t;
    }
    // tail may begin with STRUCTURED-DATA ("[...]" or "-") then the message.
    let msg = tail;
    if (msg.startsWith('-')) {
      msg = msg.slice(1).replace(/^\s+/, '');
    } else if (msg.startsWith('[')) {
      // Skip balanced structured-data groups.
      let i = 0;
      while (i < msg.length && msg[i] === '[') {
        let depth = 0;
        do {
          if (msg[i] === '[') depth++;
          else if (msg[i] === ']') depth--;
          i++;
        } while (i < msg.length && depth > 0);
      }
      msg = msg.slice(i).replace(/^\s+/, '');
    }
    // Strip a UTF-8 BOM some senders prepend to the message.
    out.message = msg.replace(/^\uFEFF/, '');
    return out;
  }

  // RFC 3164: "TIMESTAMP HOSTNAME TAG[pid]: message"
  const t3164 = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/s.exec(rest);
  if (t3164) {
    out.eventTs = parse3164Time(t3164[1], now);
    out.host = t3164[2];
    let content = t3164[3];
    const tag = /^([^\s:\[]+)(?:\[(\d+)\])?:\s*(.*)$/s.exec(content);
    if (tag) {
      out.app = tag[1];
      out.procid = tag[2] || null;
      out.message = tag[3];
    } else {
      out.message = content;
    }
    return out;
  }

  // PRI present but neither format matched — keep the remainder as the message.
  out.message = rest;
  return out;
}

module.exports = {
  parse,
  decodePri,
  SEVERITIES,
  FACILITIES,
  severityName,
  facilityName,
};

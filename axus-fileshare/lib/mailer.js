'use strict';

// Optional NOC email notifications. When SMTP is configured, the app can email a
// recipient (default noc@axustechnologies.com) whenever a share link is created
// and/or a file is uploaded. Everything is best-effort: a missing or broken SMTP
// config, or a send failure, never blocks or breaks a link/upload request.
//
// Config (env):
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   — M365 (smtp.office365.com:587)
//   SMTP_FROM               — envelope/display From (e.g. Axus File Share <no-reply@axustechnologies.com>)
//   NOTIFY_EMAIL_TO         — comma-separated recipients (default noc@axustechnologies.com)
//   NOTIFY_ON_LINK_CREATED  — '1' (default) to email when a share link is created; '0' to disable
//   NOTIFY_ON_UPLOAD        — '1' (default) to email when a file is uploaded; '0' to disable

const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER || '').trim();
const NOTIFY_TO = (process.env.NOTIFY_EMAIL_TO || 'noc@axustechnologies.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Both default ON when email is configured; set the env var to '0' to turn one off.
const NOTIFY_ON_LINK = (process.env.NOTIFY_ON_LINK_CREATED || '1') !== '0';
const NOTIFY_ON_UPLOAD = (process.env.NOTIFY_ON_UPLOAD || '1') !== '0';

let _transport = null;
let _nodemailer = null;

function configured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM && NOTIFY_TO.length);
}

function transport() {
  if (_transport) return _transport;
  if (!configured()) return null;
  try {
    if (!_nodemailer) _nodemailer = require('nodemailer');
  } catch (err) {
    console.error('[mailer] nodemailer not installed — email disabled:', err.message);
    return null;
  }
  _transport = _nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = implicit TLS; 587 = STARTTLS
    requireTLS: SMTP_PORT !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transport;
}

// Fire-and-forget send. Never throws; logs failures. Returns a promise for tests.
function send({ subject, text }) {
  const t = transport();
  if (!t) return Promise.resolve({ ok: false, error: 'not configured' });
  return t.sendMail({
    from: SMTP_FROM,
    to: NOTIFY_TO.join(', '),
    subject: String(subject || 'Axus File Share').slice(0, 200),
    text: String(text || ''),
  }).then(() => ({ ok: true }))
    .catch((err) => { console.error('[mailer] send failed:', err.message); return { ok: false, error: err.message }; });
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + ' ' + u[i];
}
function nowEt() {
  try { return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'; }
  catch (_) { return new Date().toISOString(); }
}
function fmtExpiry(ms) {
  if (!ms) return 'never';
  try { return new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'; }
  catch (_) { return new Date(ms).toISOString(); }
}

// A share link was created. `kind` is 'upload' (people send files IN) or
// 'download' (admin shares files OUT). Best-effort; gated by NOTIFY_ON_LINK.
function notifyLinkCreated({ kind, label, url, note, expiresAt, maxUses, maxDownloads, files }) {
  if (!NOTIFY_ON_LINK || !configured()) return;
  const isUpload = kind === 'upload';
  const lines = [
    `A new ${isUpload ? 'UPLOAD (people send files in)' : 'DOWNLOAD (files shared out)'} link was created in Axus File Share.`,
    '',
    `Label:   ${label || '(none)'}`,
    `Link:    ${url}`,
  ];
  if (note) lines.push(`Note:    ${note}`);
  lines.push(`Expires: ${fmtExpiry(expiresAt)}`);
  if (isUpload && maxUses) lines.push(`Max uploads: ${maxUses}`);
  if (!isUpload && maxDownloads) lines.push(`Max downloads: ${maxDownloads}`);
  if (!isUpload && Array.isArray(files) && files.length) {
    lines.push('', `Files (${files.length}):`);
    for (const f of files) lines.push(`  - ${f.originalName} (${fmtBytes(f.size)})`);
  }
  lines.push('', `Created: ${nowEt()}`);
  send({
    subject: `[Axus File Share] New ${isUpload ? 'upload' : 'download'} link: ${label || 'Untitled'}`,
    text: lines.join('\n'),
  });
}

// One or more files were uploaded via an inbound upload link. Best-effort; gated
// by NOTIFY_ON_UPLOAD.
function notifyUpload({ label, url, files, uploaderName, ip }) {
  if (!NOTIFY_ON_UPLOAD || !configured()) return;
  const n = (files || []).length;
  const lines = [
    `${n} file${n === 1 ? '' : 's'} uploaded via Axus File Share.`,
    '',
    `Via link: ${label || '(untitled)'}`,
    `Link:     ${url}`,
    `From:     ${uploaderName || '(name not given)'}${ip ? ` (${ip})` : ''}`,
    '',
    `Files (${n}):`,
    ...(files || []).map((f) => `  - ${f.originalName} (${fmtBytes(f.size)})`),
    '',
    `Uploaded: ${nowEt()}`,
  ];
  send({
    subject: `[Axus File Share] ${n} file${n === 1 ? '' : 's'} uploaded: ${label || 'upload link'}`,
    text: lines.join('\n'),
  });
}

module.exports = {
  configured, send, notifyLinkCreated, notifyUpload,
  NOTIFY_TO, NOTIFY_ON_LINK, NOTIFY_ON_UPLOAD,
};

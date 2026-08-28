#!/usr/bin/env node
/* One-shot manual alert through all channels. Usage: node send-alert.js "Title" "Body text" */
'use strict';
const fs = require('fs'), path = require('path');
const nodemailer = (() => { try { return require('nodemailer'); } catch { return null; } })();
loadDotenv(path.join(__dirname, '..', '.env'));
const e = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const NTFY_TOPIC = e('NTFY_TOPIC', ''), NTFY_SERVER = e('NTFY_SERVER', 'https://ntfy.sh'), NTFY_TOKEN = e('NTFY_TOKEN', '');
const BOOK_URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12';
const title = process.argv[2] || 'Bahia alert';
const body = process.argv[3] || '';
(async () => {
  const jobs = [];
  if (NTFY_TOPIC) {
    const headers = { Title: ascii(title), Priority: 'urgent', Tags: 'palm_tree,dart', Click: BOOK_URL };
    if (NTFY_TOKEN) headers.Authorization = 'Bearer ' + NTFY_TOKEN;
    jobs.push(fetch(`${NTFY_SERVER.replace(/\/$/, '')}/${NTFY_TOPIC}`, { method: 'POST', headers, body }).then((r) => console.log('ntfy', r.status)).catch((x) => console.log('ntfy fail', x.message)));
  }
  if (nodemailer && e('SMTP_HOST', '') && e('EMAIL_TO', '')) {
    const tx = nodemailer.createTransport({ host: e('SMTP_HOST'), port: parseInt(e('SMTP_PORT', '587'), 10), secure: /^(1|true|yes|on)$/i.test(e('SMTP_SECURE', '')), auth: e('SMTP_USER') ? { user: e('SMTP_USER'), pass: e('SMTP_PASS') } : undefined });
    jobs.push(tx.sendMail({ from: e('EMAIL_FROM') || e('SMTP_USER'), to: e('EMAIL_TO'), subject: title, text: body + '\n\n' + BOOK_URL, html: `<h2>${ascii(title)}</h2><p>${body}</p><p><a href="${BOOK_URL}">Book now →</a></p>` }).then(() => console.log('email sent')).catch((x) => console.log('email fail', x.message)));
    if (e('EMAIL_SMS_TO', '')) jobs.push(tx.sendMail({ from: e('EMAIL_FROM') || e('SMTP_USER'), to: e('EMAIL_SMS_TO').split(',').map((s) => s.trim()), subject: '', text: body + ' ' + BOOK_URL }).then(() => console.log('sms sent')).catch((x) => console.log('sms fail', x.message)));
  }
  await Promise.all(jobs);
})();
function ascii(s) { return String(s).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim(); }
function loadDotenv(f) { let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { return; } for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i); if (!m) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '').trim(); if (process.env[m[1]] == null) process.env[m[1]] = v; } }

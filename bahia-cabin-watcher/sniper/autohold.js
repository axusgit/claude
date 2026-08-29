#!/usr/bin/env node
/*
 * Bahia CABIN auto-hold (hold-only). Drives the live, logged-in CDP browser
 * (port 9222) to grab-and-HOLD a cabin the instant it opens, then alerts Andy to
 * complete checkout. Proven click-path: set date -> click cabin's available cell
 * -> Book Now -> SelectReservationPreCart.aspx (held).
 *
 * PREREQS: live-browser.js running + logged in (session dies on close, so keep it
 * open). Run this BEFORE the release window; it pre-positions on the cabins grid,
 * waits for the window, then races to hold the target day.
 *
 *   node autohold.js --day=2027-07-28 [--window=8pm|8am|now] [--nights=2]
 *   (default --day = the single day 11 months ahead; default window = 8pm)
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const CDP = 'http://127.0.0.1:9222';
const PARK = 4, FAC = 12; // Bahia cabins (Loop BAYC)
const CABINS = ['Cabin #001', 'Cabin #002', 'Cabin #003', 'Cabin #004', 'Cabin #005', 'Cabin #006'];
const API = 'https://floridardr.usedirect.com/Floridardr/rdr/';
const H = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/126', Origin: 'https://reserve.floridastateparks.org', Referer: 'https://reserve.floridastateparks.org/' };
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const NIGHTS = Number(arg('nights', 2));
const WINDOW = arg('window', '8pm');
const CABIN_UNIT = { 'Cabin #001': 177, 'Cabin #002': 173, 'Cabin #003': 174, 'Cabin #004': 175, 'Cabin #005': 176, 'Cabin #006': 172 };

function etNow() { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date()); const g = (t) => +p.find((x) => x.type === t).value; return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') }; }
function elevenMonthDayISO() { const { y, m, d } = etNow(); return new Date(y, m - 1 + 11, d).toISOString().slice(0, 10); }
const DAY = arg('day', elevenMonthDayISO()); // arrival day (ISO)
function mmddyyyy(iso) { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; }
function etHMS() { return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/[^\d:]/g, '').slice(-8); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(m) { console.error(`[${new Date().toISOString()}] ${m}`); }

// fast API check: is any cabin free for the whole stay (day..day+nights-1)?
async function freeCabins() {
  const out = [];
  await Promise.all(CABINS.map(async (name) => {
    try {
      const a = await (await fetch(`${API}fd/availability/getbyunit/${CABIN_UNIT[name]}/startdate/${DAY}/nights/${NIGHTS}/false`, { headers: H })).json();
      const need = []; for (let i = 0; i < NIGHTS; i++) { const dt = new Date(DAY + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + i); need.push(dt.toISOString().slice(0, 10)); }
      const free = new Set((Array.isArray(a) ? a : []).filter((s) => s.IsFree && !s.IsReserved && !s.IsBlocked && !s.IsLocked).map((s) => s.StartTime.slice(0, 10)));
      if (need.every((n) => free.has(n))) out.push(name);
    } catch {}
  }));
  return out;
}

async function main() {
  const b = await chromium.connectOverCDP(CDP);
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((x) => x.url().includes('floridastateparks')) || ctx.pages()[0];
  await page.bringToFront().catch(() => {});

  // verify logged in
  const authed = (await ctx.cookies()).some((c) => c.name === 'authinfo' && c.value);
  if (!authed) { log('NOT LOGGED IN in the CDP browser — log in first, then re-run.'); process.exit(1); }
  log(`Logged in. Target arrival ${DAY} (${NIGHTS}n), cabins ${FAC}, window=${WINDOW}.`);

  // pre-position: load cabins grid + set the target date
  await page.goto(`https://reserve.floridastateparks.org/Web/#!park/${PARK}/${FAC}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await setDate(page, DAY, NIGHTS);
  log('Pre-positioned on cabins grid with target date set.');

  // wait for the release window, keeping the session alive so it can't time out
  const start = WINDOW === '8am' ? '07:59:57' : WINDOW === 'now' ? etHMS() : '19:59:57';
  const end = WINDOW === '8am' ? '08:02:00' : WINDOW === 'now' ? '23:59:59' : '20:02:00';
  if (WINDOW !== 'now') {
    log(`Waiting for ${start} ET (now ${etHMS()})… (keep-alive every 3 min)`);
    let lastKA = Date.now();
    while (etHMS() < start) {
      await sleep(1000);
      if (Date.now() - lastKA > 180000) {
        lastKA = Date.now();
        const ok = (await ctx.cookies()).some((c) => c.name === 'authinfo' && c.value);
        if (!ok) { log('SESSION EXPIRED during wait — log in again on the browser and re-run.'); process.exit(1); }
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(3000);
        await setDate(page, DAY, NIGHTS); // re-prime the grid after reload
        log(`keep-alive ${etHMS()} ET: reloaded, session OK`);
      }
    }
  }
  log(`RELEASE WINDOW OPEN (${etHMS()} ET). Racing to hold ${DAY}.`);

  // race: fast API poll; the instant a cabin is free, refresh grid + click it + Book Now
  let held = null;
  while (etHMS() < end && !held) {
    const free = await freeCabins();
    if (free.length) {
      log(`OPEN: ${free.join(', ')} — attempting hold on ${free[0]}.`);
      held = await grabHold(page, ctx, free[0], DAY);
      if (!held) log('hold attempt failed; retrying next cabin/poll.');
    }
    await sleep(120);
  }

  if (held) { await alertAll(`✅ HELD Bahia ${held} ${DAY} (${NIGHTS}n) — COMPLETE CHECKOUT NOW (~15 min)`, `Auto-hold placed ${held} arriving ${DAY}. Finish payment in the open browser within ~15 min.`); log(`SUCCESS: held ${held}. Complete checkout in the browser.`); }
  else { log('Window closed without a successful hold.'); }
  process.exit(0);
}

async function setDate(page, iso, nights) {
  const arrD = new Date(iso + 'T00:00:00Z'); const depD = new Date(arrD); depD.setUTCDate(depD.getUTCDate() + nights);
  const aria = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const clickDay = (d) => page.evaluate((w) => { const norm = (s) => s.replace(/(\d+)(st|nd|rd|th)/g, '$1'); const c = [...document.querySelectorAll('.react-datepicker__day')].find((x) => norm(x.getAttribute('aria-label') || '').includes(norm(w))); if (c) { c.click(); return true; } return false; }, aria(d));
  await page.click('#search-header-datepicker').catch(() => {});
  await page.waitForTimeout(900); await clickDay(arrD); await page.waitForTimeout(500); await clickDay(depD); await page.waitForTimeout(2200);
}

// refresh the grid (re-open datepicker re-applies the search), click the cabin's
// available arrival cell, then Book Now → pre-cart (held). Returns cabin name or null.
async function grabHold(page, ctx, cabin, iso) {
  await setDate(page, iso, NIGHTS); // re-query grid so the freshly-opened cell shows
  const cellAria = `${cabin} ${mmddyyyy(iso)} - available`;
  const clicked = await page.evaluate((w) => { const btn = [...document.querySelectorAll('button[aria-label]')].find((e) => e.getAttribute('aria-label') === w); if (btn) { btn.click(); return true; } return false; }, cellAria);
  if (!clicked) return null;
  await page.waitForTimeout(1500);
  const booked = await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => /book now/i.test((x.innerText || '').trim()) && !x.disabled); if (btn) { btn.click(); return true; } return false; });
  if (!booked) return null;
  await page.waitForTimeout(5000);
  const held = page.url().includes('SelectReservationPreCart') || /reservation details/i.test(await page.evaluate(() => document.body.innerText).catch(() => ''));
  return held ? cabin : null;
}

// alerts via ntfy + email + sms (reuse ../.env)
function envs() { const e = {}; try { for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) { let v = m[2].trim().replace(/^["']|["']$/g, ''); e[m[1]] = v; } } } catch {} return e; }
async function alertAll(title, body) {
  const e = envs(); const url = 'https://reserve.floridastateparks.org/Web/#!park/4/12';
  const jobs = [];
  if (e.NTFY_TOPIC) { const h = { Title: title.replace(/[^\x20-\x7E]/g, ''), Priority: 'urgent', Click: url }; if (e.NTFY_TOKEN) h.Authorization = 'Bearer ' + e.NTFY_TOKEN; jobs.push(fetch(`${(e.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '')}/${e.NTFY_TOPIC}`, { method: 'POST', headers: h, body }).catch(() => {})); }
  try { const nm = require('nodemailer'); if (e.SMTP_HOST && e.EMAIL_TO) { const tx = nm.createTransport({ host: e.SMTP_HOST, port: +(e.SMTP_PORT || 587), secure: /^(1|true|yes|on)$/i.test(e.SMTP_SECURE || ''), auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined }); jobs.push(tx.sendMail({ from: e.EMAIL_FROM || e.SMTP_USER, to: e.EMAIL_TO, subject: title, text: body + '\n' + url }).catch(() => {})); if (e.EMAIL_SMS_TO) jobs.push(tx.sendMail({ from: e.EMAIL_FROM || e.SMTP_USER, to: e.EMAIL_SMS_TO.split(','), subject: '', text: body + ' ' + url }).catch(() => {})); } } catch {}
  await Promise.all(jobs);
}

main().catch((e) => { log('FATAL ' + e.message); process.exit(1); });

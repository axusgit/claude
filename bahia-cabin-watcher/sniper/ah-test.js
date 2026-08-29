'use strict';
const { chromium } = require('playwright');
const UNIT = process.argv[2] || 'Tent Only #075';
const ARR = process.argv[3] || '08/31/2026';   // arrival mm/dd/yyyy
const NIGHTS = Number(process.argv[4] || 1);

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((x) => x.url().includes('floridastateparks')) || ctx.pages()[0];
  await page.bringToFront().catch(() => {});

  // fresh reload of the BAYS facility
  await page.goto('https://reserve.floridastateparks.org/Web/#!park/4/13', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // set arrival + departure in the datepicker
  const [mm, dd, yyyy] = ARR.split('/').map(Number);
  const arrD = new Date(Date.UTC(yyyy, mm - 1, dd));
  const depD = new Date(arrD); depD.setUTCDate(depD.getUTCDate() + NIGHTS);
  const ariaOf = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const clickDay = async (d) => page.evaluate((w) => { const norm = (s) => s.replace(/(\d+)(st|nd|rd|th)/g, '$1'); const c = [...document.querySelectorAll('.react-datepicker__day')].find((x) => norm(x.getAttribute('aria-label') || '').includes(norm(w))); if (c) { c.click(); return true; } return false; }, ariaOf(d));
  await page.click('#search-header-datepicker').catch(() => {});
  await page.waitForTimeout(1000);
  const a1 = await clickDay(arrD); await page.waitForTimeout(600);
  const a2 = await clickDay(depD); await page.waitForTimeout(2500);
  console.log('date set arrival:', a1, 'departure:', a2, `(${NIGHTS}n)`);

  // click the unit's arrival cell
  const cellAria = `${UNIT} ${ARR} - available`;
  const cellClicked = await page.evaluate((w) => { const btn = [...document.querySelectorAll('button[aria-label]')].find((e) => e.getAttribute('aria-label') === w); if (btn) { btn.click(); return true; } return false; }, cellAria);
  console.log('cell clicked:', cellClicked, `(${cellAria})`);
  await page.waitForTimeout(2500);

  // Book Now state
  const bn = await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => /book now/i.test((x.innerText || '').trim())); return btn ? { present: true, disabled: btn.disabled || /disabled/.test(btn.className) } : { present: false }; });
  console.log('Book Now:', JSON.stringify(bn));

  if (bn.present && !bn.disabled) {
    const calls = [];
    const onReq = (r) => { const u = r.url(); if (/floridastateparks|usedirect/.test(u) && r.method() !== 'GET') calls.push(r.method() + ' ' + u.replace(/^https?:\/\/[^/]+/, '')); };
    ctx.on('request', onReq);
    await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => /book now/i.test((x.innerText || '').trim())); btn.click(); });
    await page.waitForTimeout(7000);
    ctx.off('request', onReq);
    const st = await page.evaluate(() => ({ url: location.href, hint: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400) }));
    console.log('>>> BOOKED CLICK. URL:', st.url);
    console.log('mutating calls:'); [...new Set(calls)].forEach((c) => console.log('   ' + c));
    console.log('hint:', st.hint);
  }
  await page.screenshot({ path: 'ah.png', fullPage: true });
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

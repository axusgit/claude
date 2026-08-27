#!/usr/bin/env node
/*
 * Attaches to the long-lived logged-in browser over CDP (port 9222) and runs a
 * sub-command. NEVER closes the browser (only disconnects), so the session stays
 * alive for the next step.
 *
 *   node driver.js check                         # verify login + dump header controls
 *   node driver.js setdate 2027-08-05 2          # open datepicker, set arrival + nights, dump cabins
 *   node driver.js dump                          # dump interactive elements of current page
 */
'use strict';
const { chromium } = require('playwright');

const CMD = process.argv[2] || 'check';
const ARG1 = process.argv[3];
const ARG2 = process.argv[4];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  try {
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    const page = pages.find((p) => p.url().includes('floridastateparks')) || pages[0];
    await page.bringToFront().catch(() => {});

    if (CMD === 'check') {
      const cookies = await ctx.cookies();
      const authinfo = cookies.find((c) => c.name === 'authinfo');
      const state = await page.evaluate(() => {
        const t = (document.body.innerText || '');
        const has = (re) => re.test(t);
        const loginBtn = document.querySelector('#login-btn');
        const acct = [...document.querySelectorAll('a,button,span,div')].map((e) => (e.innerText || '').trim()).filter((s) => /log ?out|sign ?out|my account|welcome|hi,/i.test(s)).slice(0, 5);
        return { url: location.href, hasLoginWord: has(/\bLogin\b/), loginBtnVisible: !!loginBtn, acctHints: acct };
      });
      console.log('URL:', state.url);
      console.log('authinfo cookie present:', !!authinfo, authinfo ? '(len ' + (authinfo.value || '').length + ')' : '');
      console.log('Login word present:', state.hasLoginWord, '| #login-btn present:', state.loginBtnVisible);
      console.log('account/logout hints:', JSON.stringify(state.acctHints));
      console.log(authinfo && !state.loginBtnVisible ? '=> LOOKS LOGGED IN' : '=> login state UNCLEAR (see above)');
    } else if (CMD === 'dp') {
      // Open the date picker and dump its structure so we can learn how to set dates.
      await page.click('#search-header-datepicker').catch((e) => console.log('click dp:', e.message));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'dp.png' }).catch(() => {});
      const info = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        // find the calendar container
        const cal = document.querySelector('[class*=calendar],[class*=datepicker],[role=dialog],[class*=Calendar]');
        const scope = cal || document.body;
        const heads = [...scope.querySelectorAll('[class*=month],[class*=Month],[class*=header],h2,h3,caption')].filter(vis).map(txt).filter(Boolean).slice(0, 8);
        const navs = [...scope.querySelectorAll('button,[role=button]')].filter(vis).map((e) => ({ text: txt(e), aria: e.getAttribute('aria-label') || undefined, cls: (e.className || '').toString().slice(0, 40) })).filter((x) => x.text || x.aria).slice(0, 25);
        const dayCells = [...scope.querySelectorAll('[class*=day],[class*=Day],td[role=gridcell],[role=gridcell],button[aria-label*=202]')].filter(vis).slice(0, 10).map((e) => ({ tag: e.tagName.toLowerCase(), text: txt(e), aria: e.getAttribute('aria-label') || undefined, cls: (e.className || '').toString().slice(0, 45) }));
        return { calFound: !!cal, calClass: cal ? cal.className.toString().slice(0, 60) : null, heads, navsSample: navs, dayCellsSample: dayCells };
      });
      console.log(JSON.stringify(info, null, 1));
    } else if (CMD === 'furthest') {
      // Open datepicker if needed, click "Furthest Arrival Date", then dump the grid.
      const dpBtn = await page.$('#search-header-datepicker');
      if (dpBtn) { await dpBtn.click().catch(() => {}); await page.waitForTimeout(1200); }
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button,a')].find((e) => /furthest arrival date/i.test((e.innerText || '').trim()) && !/camping/i.test(e.innerText));
        if (b) { b.click(); return b.innerText.trim(); } return null;
      });
      console.log('clicked:', clicked);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'furthest.png' }).catch(() => {});
      const grid = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        // header showing the week range
        const wk = [...document.querySelectorAll('*')].map((e) => (e.childElementCount === 0 ? (e.innerText || '').trim() : '')).find((t) => /\w+ \d+ ?[-–] ?\w+ \d+/.test(t) || /202[6-9]/.test(t) && /night/i.test(t));
        // available cells: legend says "Available Dates" green. Find cells with an availability class or a book/available marker.
        const cells = [...document.querySelectorAll('[class*=available],[class*=Available],[aria-label*="available" i],[title*="available" i],button[class*=cell]')].filter(vis).slice(0, 20)
          .map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || '').trim().slice(0, 30), aria: e.getAttribute('aria-label') || undefined, title: e.getAttribute('title') || undefined, cls: (e.className || '').toString().slice(0, 55) }));
        return { weekHint: wk, availCellCount: cells.length, cells };
      });
      console.log(JSON.stringify(grid, null, 1));
    } else if (CMD === 'dpcells') {
      // Dump every visible datepicker day cell with aria-label + class, to see
      // which 2027 dates are actually selectable vs "Not available".
      const cells = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return [...document.querySelectorAll('.react-datepicker__day')].filter(vis).map((e) => ({
          aria: e.getAttribute('aria-label') || '',
          disabled: /disabled/.test(e.className) || e.getAttribute('aria-disabled') === 'true',
          cls: (e.className || '').toString().replace('react-datepicker__day custom-datepicker-day ', '').slice(0, 70),
        })).filter((c) => /202[6-9]/.test(c.aria));
      });
      // summarize: for each aria, is it "Not available" or selectable
      const y2027 = cells.filter((c) => /2027/.test(c.aria));
      console.log('2027 day cells visible:', y2027.length);
      for (const c of y2027) {
        const avail = /Not available/i.test(c.aria) ? 'NOT-AVAIL' : (c.disabled ? 'DISABLED' : 'SELECTABLE');
        console.log(`  ${avail.padEnd(10)} ${c.aria}   [${c.cls}]`);
      }
    } else if (CMD === 'dump') {
      const els = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const txt = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        return [...document.querySelectorAll('button,a[href],[role=button],input,select,.btn')].filter(vis).slice(0, 80).map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id || undefined, text: txt(e), cls: (e.className || '').toString().slice(0, 40) || undefined }));
      });
      console.log(JSON.stringify(els, null, 1));
    }
  } catch (e) {
    console.error('DRIVER ERROR:', e && e.stack ? e.stack : e);
  } finally {
    // DO NOT browser.close() — that would kill the live session. Just disconnect.
    process.exit(0);
  }
})().catch((e) => { console.error('FATAL:', e && e.stack ? e.stack : e); process.exit(1); });

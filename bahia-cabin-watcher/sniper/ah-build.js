#!/usr/bin/env node
/*
 * Auto-hold build helper. Drives the live logged-in CDP browser to map the
 * add-to-cart/hold flow. Sub-commands run one step so we can iterate.
 *   node ah-build.js goto 13            # navigate to a facility (park 4)
 *   node ah-build.js grid 2026-08-31    # set arrival date + dump the site-list grid
 *   node ah-build.js shot NAME          # screenshot
 */
'use strict';
const { chromium } = require('playwright');
const CMD = process.argv[2], A1 = process.argv[3];

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((x) => x.url().includes('floridastateparks')) || ctx.pages()[0];
  await page.bringToFront().catch(() => {});
  try {
    if (CMD === 'goto') {
      await page.goto(`https://reserve.floridastateparks.org/Web/#!park/4/${A1}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: 'ah.png' });
      console.log('at', page.url());
    } else if (CMD === 'grid') {
      // open datepicker, click arrival A1, then departure A1+2, then dump grid
      const arrival = A1; const dep = new Date(arrival + 'T00:00:00Z'); dep.setUTCDate(dep.getUTCDate() + 2); const depISO = dep.toISOString().slice(0, 10);
      const lbl = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
      const clickDay = async (iso) => {
        const wanted = lbl(iso); // e.g. "Monday, August 31, 2026" -> aria has "August 31st, 2026"
        const ok = await page.evaluate((w) => {
          const norm = (s) => s.replace(/(\d+)(st|nd|rd|th)/g, '$1');
          const cells = [...document.querySelectorAll('.react-datepicker__day')];
          const t = cells.find((c) => norm(c.getAttribute('aria-label') || '').includes(norm('Choose ' + w)) || norm(c.getAttribute('aria-label') || '').includes(norm(w)));
          if (t) { t.click(); return t.getAttribute('aria-label'); } return null;
        }, wanted);
        return ok;
      };
      await page.click('#search-header-datepicker').catch(() => {});
      await page.waitForTimeout(1000);
      const a = await clickDay(arrival); await page.waitForTimeout(600);
      const d = await clickDay(depISO); await page.waitForTimeout(2500);
      console.log('clicked arrival:', a, '| departure:', d);
      await page.screenshot({ path: 'ah.png' });
      // dump the site-list grid: rows (units) and any available/clickable cells + action buttons
      const dump = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 45);
        const avail = [...document.querySelectorAll('[class*=available i], [aria-label*="available" i], a[href*="Cart" i], button')].filter(vis)
          .map((e) => ({ tag: e.tagName.toLowerCase(), text: txt(e), aria: e.getAttribute('aria-label') || undefined, cls: (e.className || '').toString().slice(0, 50) }))
          .filter((x) => x.text || x.aria).slice(0, 40);
        return { bodyHas: /add to cart|reserve|book now/i.test(document.body.innerText), avail };
      });
      console.log(JSON.stringify(dump, null, 1));
    } else if (CMD === 'cells') {
      // Dump the site-list grid: for each unit row, list its cells with classes so
      // we can find the clickable "available" cell.
      const rows = await page.evaluate(() => {
        const out = [];
        // find row labels like "Tent Only #075" / "Cabin #001"
        const labels = [...document.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && /^(Tent Only|Cabin|Site)\s*#?\s*\d+/i.test((e.innerText || '').trim()));
        for (const lab of labels.slice(0, 3)) {
          let row = lab; for (let i = 0; i < 6 && row && row.parentElement; i++) { row = row.parentElement; if (row.querySelectorAll('*').length > 8) break; }
          const cells = [...row.querySelectorAll('a,button,td,div,span')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 8 && r.width < 80 && r.height > 8; })
            .map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().slice(0, 55), aria: e.getAttribute('aria-label') || undefined, click: !!(e.onclick) || e.tagName === 'A' || e.tagName === 'BUTTON' })).slice(0, 14);
          out.push({ unit: (lab.innerText || '').trim(), cells });
        }
        return out;
      });
      console.log(JSON.stringify(rows, null, 1));
    } else if (CMD === 'click') {
      // Click a grid cell by its aria-label (pass via A1) and capture what happens.
      const wantAria = A1; // e.g. "Tent Only #075 08/31/2026 - available"
      const calls = [];
      const onReq = (r) => { const u = r.url(); if (/floridastateparks|usedirect/.test(u) && r.method() !== 'GET') calls.push(r.method() + ' ' + u.replace(/^https?:\/\/[^/]+/, '')); };
      ctx.on('request', onReq);
      const before = page.url();
      const clicked = await page.evaluate((w) => { const b = [...document.querySelectorAll('button[aria-label]')].find((e) => e.getAttribute('aria-label') === w); if (b) { b.click(); return true; } return false; }, wantAria);
      console.log('clicked cell:', clicked);
      await page.waitForTimeout(5000);
      ctx.off('request', onReq);
      await page.screenshot({ path: 'ah.png', fullPage: true });
      const state = await page.evaluate(() => ({ url: location.href, title: document.title, bodyHint: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400) }));
      console.log('URL after:', state.url);
      console.log('title:', state.title);
      console.log('POST/mutating calls during click:');
      [...new Set(calls)].forEach((c) => console.log('   ' + c));
      console.log('body hint:', state.bodyHint);
    } else if (CMD === 'booknow') {
      // Report the current detail-panel state: is "Book Now" present/enabled?
      const st = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /book now/i.test((b.innerText || '').trim()));
        const nights = [...document.querySelectorAll('*')].map((e) => (e.childElementCount === 0 ? (e.innerText || '').trim() : '')).filter((t) => /^\d+ Night/i.test(t))[0];
        return { hasBookNow: !!btn, disabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || /disabled/.test(btn.className)) : null, nights };
      });
      console.log(JSON.stringify(st));
    } else if (CMD === 'setnights') {
      // Open the nights dropdown in the panel and choose "A1 Night(s)".
      const want = A1; // "1"
      await page.evaluate(() => { const d = [...document.querySelectorAll('*')].find((e) => e.childElementCount <= 2 && /^\s*\d+ Nights?\s*/i.test((e.innerText || '').trim()) && e.getBoundingClientRect().width > 0); if (d) d.click(); });
      await page.waitForTimeout(900);
      const picked = await page.evaluate((w) => { const o = [...document.querySelectorAll('li,option,button,div,span,a')].find((e) => new RegExp('^\\s*' + w + '\\s+Night', 'i').test((e.innerText || '').trim()) && e.getBoundingClientRect().width > 0); if (o) { o.click(); return o.innerText.trim(); } return null; }, want);
      await page.waitForTimeout(1500);
      console.log('picked nights option:', picked);
    } else if (CMD === 'clickbook') {
      // Click Book Now and capture the hold/pre-cart flow.
      const calls = [];
      const onReq = (r) => { const u = r.url(); if (/floridastateparks|usedirect/.test(u) && r.method() !== 'GET') calls.push(r.method() + ' ' + u.replace(/^https?:\/\/[^/]+/, '')); };
      ctx.on('request', onReq);
      const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /book now/i.test((x.innerText || '').trim()) && !x.disabled); if (b) { b.click(); return true; } return false; });
      console.log('clicked Book Now:', clicked);
      await page.waitForTimeout(6000);
      ctx.off('request', onReq);
      await page.screenshot({ path: 'ah.png', fullPage: true });
      const st = await page.evaluate(() => ({ url: location.href, title: document.title, hint: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500) }));
      console.log('URL after:', st.url);
      console.log('mutating calls:'); [...new Set(calls)].forEach((c) => console.log('   ' + c));
      console.log('hint:', st.hint);
    } else if (CMD === 'shot') {
      await page.screenshot({ path: (A1 || 'ah') + '.png', fullPage: true });
      console.log('shot saved');
    }
  } catch (e) { console.error('ERR', e.message); }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

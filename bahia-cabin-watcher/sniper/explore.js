#!/usr/bin/env node
/*
 * Read-only recon of the booking UI using the persisted login. Navigates to the
 * cabins facility, waits for the SPA, screenshots it, and dumps the interactive
 * elements (buttons/links/inputs/date cells) so we can find the add-to-cart path.
 * Does NOT click add-to-cart or place any hold.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const OUT = process.env.OUT_DIR || __dirname;
const URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null, args: ['--start-maximized'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); ok = true; }
    catch (e) { console.log(`goto attempt ${i + 1}:`, e.message); await page.waitForTimeout(2000); }
  }
  await page.waitForTimeout(7000); // let the React SPA render the grid

  await page.screenshot({ path: path.join(OUT, 'explore.png'), fullPage: true }).catch(() => {});

  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const txt = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const grab = (sel) => [...document.querySelectorAll(sel)].filter(vis).slice(0, 40).map((el) => ({
      tag: el.tagName.toLowerCase(), text: txt(el), id: el.id || undefined,
      cls: (el.className && el.className.toString().slice(0, 60)) || undefined,
      href: el.getAttribute && el.getAttribute('href') || undefined,
      type: el.getAttribute && el.getAttribute('type') || undefined,
    }));
    const bodyText = document.body.innerText.replace(/\s+/g, ' ').slice(0, 800);
    return {
      url: location.href, title: document.title, bodyText,
      buttons: grab('button, [role=button], .btn, input[type=button], input[type=submit]'),
      links: grab('a[href]'),
      inputs: grab('input, select'),
      dateish: grab('[class*=day], [class*=cell], [class*=grid] [class*=available], [class*=Available], td'),
    };
  }).catch((e) => ({ error: e.message }));

  require('fs').writeFileSync(path.join(OUT, 'explore.json'), JSON.stringify(info, null, 2));
  console.log('URL:', info.url);
  console.log('TITLE:', info.title);
  console.log('BODY (first 800):', info.bodyText);
  console.log('\nBUTTONS:', JSON.stringify(info.buttons, null, 1));
  console.log('\nINPUTS:', JSON.stringify(info.inputs, null, 1));
  await ctx.close();
})();

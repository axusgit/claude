#!/usr/bin/env node
/*
 * Bahia sniper — LOGIN & CAPTURE (run this on Andy's PC, not the box).
 *
 * Opens a real Chrome window with a PERSISTENT profile so your login (cookies,
 * localStorage, "keep me signed in") survives on disk and the sniper can reuse it
 * without re-solving the reCAPTCHA. While it's open it also records every request
 * to the UseDirect reservation backend, so a practice "add to cart" captures the
 * exact authed HOLD/checkout call the sniper needs to replay.
 *
 * Nothing here books or pays for anything. It saves a session and a network log.
 *
 *   npm install          # once, installs Playwright + Chromium
 *   npx playwright install chromium
 *   node login-setup.js
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'browser-profile'); // persistent login profile
const AUTH_FILE = path.join(__dirname, 'auth.json');          // portable storageState export
const CAPTURE_FILE = path.join(__dirname, 'network-capture.jsonl');
const START_URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12'; // Bahia cabins
// Capture ALL API calls to ANY host (the cart/checkout flow spans more than one
// backend), skipping only static assets so the log stays readable.
const SKIP_TYPES = new Set(['image', 'stylesheet', 'font', 'media', 'script']);

(async () => {
  // Fresh capture file each run so we don't mix sessions.
  try { fs.writeFileSync(CAPTURE_FILE, ''); } catch {}

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });

  const logRec = (rec) => { try { fs.appendFileSync(CAPTURE_FILE, JSON.stringify(rec) + '\n'); } catch {} };

  context.on('request', (req) => {
    if (SKIP_TYPES.has(req.resourceType())) return;
    const url = req.url();
    logRec({
      t: new Date().toISOString(), dir: 'req',
      type: req.resourceType(), method: req.method(), url,
      postData: req.postData() || null,
      headers: req.headers(),
    });
    if (req.method() === 'POST') console.log(`  [capture] POST ${url}`);
  });
  context.on('response', async (res) => {
    const req = res.request();
    if (SKIP_TYPES.has(req.resourceType())) return;
    const url = res.url();
    let bodyPreview = null;
    try {
      if ((res.headers()['content-type'] || '').includes('json')) {
        bodyPreview = (await res.text()).slice(0, 3000);
      }
    } catch {}
    logRec({ t: new Date().toISOString(), dir: 'res', status: res.status(), method: req.method(), url, bodyPreview });
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n==================== BAHIA SNIPER — LOGIN & CAPTURE ====================');
  console.log('A Chrome window is open. In THAT window:');
  console.log('  1) Sign in. CHECK "keep me signed in" and solve the reCAPTCHA.');
  console.log('     (Let the browser save the password if it offers.)');
  console.log('  2) Find ANY available site + dates and click through to');
  console.log('     ADD TO CART. If no cabin is open, a tent/RV site is fine —');
  console.log('     the hold request has the same shape for every facility.');
  console.log('  3) Go as far as the cart / "start checkout" page. *** DO NOT PAY. ***');
  console.log('  4) When done, just CLOSE the Chrome window (or press ENTER here).');
  console.log('     Your session auto-saves every few seconds, so nothing is lost.');
  console.log('=======================================================================\n');

  // Auto-save the session periodically so we capture it even if the window is
  // simply closed (storageState can't be exported once the context is gone).
  let lastSaveOk = false;
  const saveTimer = setInterval(async () => {
    try { await context.storageState({ path: AUTH_FILE }); lastSaveOk = true; } catch {}
  }, 8000);

  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    process.stdin.resume();
    process.stdin.once('data', finish); // pressing ENTER also finishes
    context.on('close', finish);        // closing the window finishes
  });

  clearInterval(saveTimer);
  try { await context.storageState({ path: AUTH_FILE }); lastSaveOk = true; } catch {}
  console.log(lastSaveOk
    ? `\n✓ Saved login session  -> ${AUTH_FILE}`
    : `\n(!) storageState not exported, but ./browser-profile still holds your login.`);
  console.log(`✓ Network capture      -> ${CAPTURE_FILE}`);
  console.log('  Persistent profile   -> ./browser-profile (the sniper reuses this)');
  await context.close().catch(() => {});
  process.exit(0);
})();

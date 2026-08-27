#!/usr/bin/env node
/*
 * Long-lived headed browser for the sniper. Launches the persistent profile with
 * a CDP debug port and STAYS OPEN so (a) Andy logs in once (captcha) and the
 * session stays alive, and (b) driver scripts attach over CDP to explore/grab in
 * that same logged-in session. Kill it to end the session.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const PORT = 9222;
const URL = 'https://reserve.floridastateparks.org/Web/#!park/4/12';

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: [`--remote-debugging-port=${PORT}`, '--start-maximized'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto:', e.message));
  console.log(`[live-browser] up on CDP port ${PORT}. LOG IN in this window (check "keep me signed in"), then leave it open.`);
  await new Promise(() => {}); // stay alive until killed
})();

#!/usr/bin/env node
/*
 * Bahia Honda RELEASE-TIMING probe (read-only, no credentials).
 *
 * Purpose: pin down the exact daily-release mechanic so the sniper can be tuned.
 * It does NOT book or hold anything — it only reads the public availability grid
 * and records, at high time-resolution, (a) the global booking horizon (latest
 * bookable date) and (b) whether the newest dates are ever briefly FREE at the
 * moment they open.
 *
 * Designed to be cron'd for a ~12-minute window bracketing 8:00 AM ET. Each poll
 * appends one JSON line to release-log.jsonl. When the horizon advances or a free
 * night appears at the edge, it logs a loud TRANSITION marker with a ms timestamp.
 *
 *   node release-probe.js                # run once, ~12 min, 5s cadence
 *   node release-probe.js --minutes=12 --interval=5000
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = 'https://floridardr.usedirect.com/Floridardr/rdr/search/grid';
const FACILITY_ID = 12;              // Bahia Honda cabins loop
const LOG = path.join(__dirname, 'release-log.jsonl');

const argN = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const RUN_MS = argN('minutes', 12) * 60 * 1000;
const INTERVAL_MS = argN('interval', 5000);
// How far out to point the grid request so the returned page reaches the horizon.
// The edge is ~11 months (~335 days) out; request a bit before it and read the max.
const PROBE_OFFSET_DAYS = argN('offset', 320);

function mmddyyyy(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}-${day}-${d.getFullYear()}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function etString(d) {
  // Box runs UTC; ET is UTC-4 (EDT) or UTC-5 (EST). Report both so DST is unambiguous.
  try { return d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }); }
  catch { return '(no tzdata) UTC ' + d.toISOString(); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollOnce() {
  const start = addDays(new Date(), PROBE_OFFSET_DAYS);
  const body = {
    FacilityId: FACILITY_ID, StartDate: mmddyyyy(start), Nights: 2,
    UnitTypeId: 0, UnitCategoryId: 0, UnitTypesGroupIds: [], SleepingUnitId: 0,
    MinVehicleLength: 0, IsADA: false, WebOnly: true,
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
      Origin: 'https://reserve.floridastateparks.org',
      Referer: 'https://reserve.floridastateparks.org/',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const j = await res.json();
  const units = (j.Facility && j.Facility.Units) || {};
  const byDate = {}; // date -> {free,total}
  for (const u of Object.values(units)) {
    for (const s of Object.values(u.Slices || {})) {
      if (!s.Date) continue;
      const b = byDate[s.Date] || (byDate[s.Date] = { free: 0, total: 0 });
      b.total++; if (s.IsFree) b.free++;
    }
  }
  const dates = Object.keys(byDate).sort();
  const horizon = dates[dates.length - 1] || null;
  // free cabins on the last 3 dates of the window (where a fresh release would show)
  const edge = dates.slice(-3).map((d) => ({ d, free: byDate[d].free, total: byDate[d].total }));
  const anyEdgeFree = edge.some((e) => e.free > 0);
  return { ok: true, horizon, edge, anyEdgeFree };
}

(async () => {
  const t0 = Date.now();
  let prevHorizon = null;
  let polls = 0, errors = 0;
  console.error(`[release-probe] start ${new Date().toISOString()} (ET ${etString(new Date())}) run=${RUN_MS / 60000}min every ${INTERVAL_MS}ms`);
  while (Date.now() - t0 < RUN_MS) {
    const ts = new Date();
    let r;
    try { r = await pollOnce(); } catch (e) { r = { ok: false, error: e.message }; }
    polls++;
    if (!r.ok) errors++;
    const rec = { t: ts.toISOString(), et: etString(ts), ...r };
    // Loud transition markers.
    if (r.ok && prevHorizon && r.horizon && r.horizon > prevHorizon) {
      rec.TRANSITION = 'HORIZON_ADVANCED';
      rec.from = prevHorizon; rec.to = r.horizon;
      console.error(`[release-probe] *** HORIZON ADVANCED ${prevHorizon} -> ${r.horizon} at ${ts.toISOString()} (ET ${rec.et}) ***`);
    }
    if (r.ok && r.anyEdgeFree) {
      rec.TRANSITION = (rec.TRANSITION ? rec.TRANSITION + '+' : '') + 'EDGE_FREE';
      console.error(`[release-probe] *** FREE AT EDGE ${JSON.stringify(r.edge)} at ${ts.toISOString()} (ET ${rec.et}) ***`);
    }
    if (r.ok) prevHorizon = r.horizon;
    try { fs.appendFileSync(LOG, JSON.stringify(rec) + '\n'); } catch {}
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, INTERVAL_MS - ((Date.now() - ts.getTime())));
    if (elapsed + wait >= RUN_MS) break;
    await sleep(wait);
  }
  console.error(`[release-probe] done ${new Date().toISOString()} polls=${polls} errors=${errors} horizon=${prevHorizon}`);
})();

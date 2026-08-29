#!/usr/bin/env node
/*
 * Release-time probe. Logs the current booking frontier so we can see EXACTLY
 * when new 11-month inventory releases (8AM vs 8PM ET). Cron every 5 min; append
 * one line to release-time.log. Signal = "maxStart" (newest reservation START
 * across the 6 cabins) — since these dates get booked within seconds of release,
 * the timestamp where maxStart jumps ≈ the release time.
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = 'https://floridardr.usedirect.com/Floridardr/rdr/';
const H = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/126', Origin: 'https://reserve.floridastateparks.org', Referer: 'https://reserve.floridastateparks.org/' };
const CAB = { '#001': 177, '#002': 173, '#003': 174, '#004': 175, '#005': 176, '#006': 172 };
const LOG = path.join(__dirname, 'release-time.log');
const iso = (d) => d.toISOString().slice(0, 10);
const addD = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
function etStr() { try { return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }); } catch { return new Date().toISOString(); } }

(async () => {
  let maxStart = '', maxAnySlice = '';
  for (const [name, id] of Object.entries(CAB)) {
    let a; try { a = await (await fetch(API + 'fd/availability/getbyunit/' + id + '/startdate/2027-07-15/nights/30/false', { headers: H })).json(); } catch { continue; }
    if (!Array.isArray(a)) continue;
    const bd = {};
    for (const s of a) { const d = s.StartTime.slice(0, 10); bd[d] = { r: s.IsReserved, id: s.ReservationId }; if (d > maxAnySlice) maxAnySlice = d; }
    for (const d of Object.keys(bd).sort()) { const c = bd[d]; if (!c.r) continue; const p = bd[addD(d, -1)]; if ((!p || !p.r || p.id !== c.id) && d > maxStart) maxStart = d; }
    await new Promise((r) => setTimeout(r, 150));
  }
  const line = JSON.stringify({ t: new Date().toISOString(), et: etStr(), maxStart, maxAnySlice });
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
  console.log(line);
})();

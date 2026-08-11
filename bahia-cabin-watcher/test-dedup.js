// Unit tests for the sticky/cooldown dedup. Run: node test-dedup.js
'use strict';
const { reconcile, loadSeen } = require('./watcher.js');

const GAP = 6 * 60 * 60 * 1000; // 6h
const TODAY = '2026-08-11';
const MIN = 60 * 1000;
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } }

// helper: an opening object with a set of night dates
const op = (unitId, ...dates) => ({ unitId, unit: 'Cabin', isAda: false, checkIn: dates[0], checkOut: dates[dates.length - 1], nights: dates.length, nightDates: dates, minStay: 2 });

// t0 baseline
let t = Date.now();
const cabin = () => op(177, '2026-08-12', '2026-08-13');

// 1) Brand-new opening -> fresh, and after alert it's remembered
let r = reconcile([cabin()], {}, t, GAP, TODAY);
check('new opening is fresh', r.fresh.length === 1);
let seen = r.buildSeen(true);
check('remembered after successful alert', Object.keys(seen).length === 2);

// 2) Same opening next scan (30s later) -> NOT fresh (the 6pm bug case)
t += 30 * 1000;
r = reconcile([cabin()], seen, t, GAP, TODAY);
check('same opening 30s later is NOT fresh', r.fresh.length === 0);
seen = r.buildSeen(false);

// 3) FLICKER: opening vanishes for one scan, then returns within the gap -> NOT fresh
t += 30 * 1000;
let rGone = reconcile([], seen, t, GAP, TODAY); // 0 openings this scan
check('empty scan produces no fresh', rGone.fresh.length === 0);
seen = rGone.buildSeen(false); // memory must survive the empty scan
check('memory survives an empty scan', Object.keys(seen).length === 2);
t += 30 * 1000;
r = reconcile([cabin()], seen, t, GAP, TODAY); // reappears seconds later
check('flicker reappearance is NOT fresh (bug fixed)', r.fresh.length === 0);
seen = r.buildSeen(false);

// 4) GENUINE REOPEN: gone long enough (> gap) then returns -> fresh again
let tGone = t + GAP + 5 * MIN; // simulate it being gone > 6h (last-seen timestamp ages)
r = reconcile([cabin()], seen, tGone, GAP, TODAY);
check('reopen after > gap IS fresh again', r.fresh.length === 1);
seen = r.buildSeen(true);

// 5) GROW: an extra adjacent night opens -> fresh (new night), same-night part not re-alerted alone
t = tGone + 30 * 1000;
r = reconcile([op(177, '2026-08-12', '2026-08-13', '2026-08-14')], seen, t, GAP, TODAY);
check('a newly-freed extra night IS fresh', r.fresh.length === 1);
seen = r.buildSeen(true);
r = reconcile([op(177, '2026-08-12', '2026-08-13', '2026-08-14')], seen, t + 30000, GAP, TODAY);
check('after alerting the extra night, no re-alert', r.fresh.length === 0);

// 6) SHRINK: a night gets booked (window smaller) -> remaining nights already seen -> NOT fresh
r = reconcile([op(177, '2026-08-13', '2026-08-14')], seen, t + 60000, GAP, TODAY);
check('window shrink does NOT re-alert', r.fresh.length === 0);

// 7) FAILED alert -> stays fresh next run (retry)
let s2 = {};
let r7 = reconcile([cabin()], s2, t, GAP, TODAY);
s2 = r7.buildSeen(false); // alert failed
let r7b = reconcile([cabin()], s2, t + 30000, GAP, TODAY);
check('failed alert retries (still fresh)', r7b.fresh.length === 1);

// 8) PRUNE past dates
let s3 = { '177|2026-08-01': t, '177|2026-08-20': t }; // one past, one future
let r8 = reconcile([], s3, t, GAP, TODAY);
let s3n = r8.buildSeen(false);
check('past night pruned from memory', s3n['177|2026-08-01'] === undefined);
check('future night kept in memory', s3n['177|2026-08-20'] !== undefined);

// 9) migration from old array form
const mig = loadSeen({ seenNights: ['177|2026-08-12', '177|2026-08-13'] }, t);
check('migrates old array state', mig['177|2026-08-12'] === t && Object.keys(mig).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

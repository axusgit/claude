#!/usr/bin/env node
/*
 * Local control panel for the Bahia Honda cabin watcher.
 *
 *   node gui.js       (or: npm run gui, or double-click gui.bat)
 *
 * Opens a small web form in your browser to set the search parameters. On save
 * it writes config.json to the watcher on the box over your existing SSH alias,
 * so the next cron run (every 3 min) uses the new settings — no restart needed.
 * "Check now" previews current availability without sending any notification.
 */

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.GUI_PORT ? parseInt(process.env.GUI_PORT, 10) : 8787;
const SSH_HOST = process.env.SSH_HOST || 'axus-server01';
const REMOTE_DIR = process.env.REMOTE_DIR || '~/bahia-cabin-watcher';

// --- helpers ---------------------------------------------------------------
function ssh(remoteCmd, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', [SSH_HOST, remoteCmd], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `ssh exited ${code}`)));
    if (stdin != null) { p.stdin.write(stdin); p.stdin.end(); }
  });
}

const FIELDS = ['minNights', 'monthsAhead', 'startOffsetDays', 'watchStart', 'watchEnd', 'weekendsOnly'];

function sanitize(raw) {
  const c = {};
  c.minNights = clampInt(raw.minNights, 1, 30, 2);
  c.monthsAhead = clampInt(raw.monthsAhead, 1, 11, 6);
  c.startOffsetDays = clampInt(raw.startOffsetDays, 0, 330, 0);
  c.watchStart = isoOrEmpty(raw.watchStart);
  c.watchEnd = isoOrEmpty(raw.watchEnd);
  c.weekendsOnly = !!raw.weekendsOnly;
  return c;
}
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function isoOrEmpty(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : ''; }

async function readConfig() {
  const out = await ssh(`cat ${REMOTE_DIR}/config.json 2>/dev/null || echo '{}'`);
  let cfg = {};
  try { cfg = JSON.parse(out); } catch { cfg = {}; }
  return sanitize(cfg);
}
async function writeConfig(cfg) {
  const json = JSON.stringify(cfg, null, 2);
  await ssh(`cat > ${REMOTE_DIR}/config.json`, json + '\n');
}
async function checkNow() {
  const out = await ssh(`cd ${REMOTE_DIR} && /usr/bin/node watcher.js --json`);
  return JSON.parse(out.trim());
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

// --- server ----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (req.method === 'GET' && req.url === '/api/config') {
      return sendJson(res, 200, await readConfig());
    }
    if (req.method === 'POST' && req.url === '/api/config') {
      const cfg = sanitize(await readBody(req));
      await writeConfig(cfg);
      let result = null, checkError = null;
      try { result = await checkNow(); } catch (e) { checkError = e.message; }
      return sendJson(res, 200, { saved: true, config: cfg, result, checkError });
    }
    if (req.method === 'POST' && req.url === '/api/check') {
      return sendJson(res, 200, { result: await checkNow() });
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Bahia cabin watcher control panel: ${url}`);
  console.log(`(SSH host: ${SSH_HOST}, remote dir: ${REMOTE_DIR})`);
  openBrowser(url);
});

function openBrowser(url) {
  if (process.env.GUI_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* ignore */ }
}

// --- page (self-contained) -------------------------------------------------
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bahia Honda Cabin Watcher</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#ea580c;--accent2:#f97316;--ok:#16a34a}
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:640px;margin:32px auto;padding:0 16px}
  h1{font-size:20px;margin:0 0 2px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  .hint{font-weight:400;color:var(--muted);font-size:12px}
  input[type=number],input[type=date]{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px;font-family:inherit}
  .row{display:flex;gap:12px}.row>div{flex:1}
  .check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:14px}
  .check input{width:16px;height:16px;accent-color:var(--accent)}
  .btns{display:flex;gap:10px;margin-top:20px}
  button{font-family:inherit;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  button:disabled{opacity:.55;cursor:default}
  .msg{font-size:13px;margin-top:12px;min-height:18px}
  .ok{color:var(--ok)}.err{color:#dc2626}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#fff7ed;color:var(--accent);font-size:12px;font-weight:600;border:1px solid #fed7aa}
  a{color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>🏝️ Bahia Honda Cabin Watcher</h1>
  <div class="sub">6 cabins &middot; checked every 3 min &middot; alerts on push, email &amp; text</div>

  <div class="card">
    <label>Minimum nights <span class="hint">(park requires 2)</span></label>
    <input type="number" id="minNights" min="1" max="30">

    <div class="row">
      <div>
        <label>Scan months ahead <span class="hint">(1–11)</span></label>
        <input type="number" id="monthsAhead" min="1" max="11">
      </div>
      <div>
        <label>Earliest check-in <span class="hint">(days from today)</span></label>
        <input type="number" id="startOffsetDays" min="0" max="330">
      </div>
    </div>

    <label style="margin-top:18px">Specific date window <span class="hint">— leave blank to watch ANY opening</span></label>
    <div class="row">
      <div><input type="date" id="watchStart"></div>
      <div><input type="date" id="watchEnd"></div>
    </div>

    <div class="check"><input type="checkbox" id="weekendsOnly"><label style="margin:0;font-weight:400">Only alert on stays including a Fri or Sat night</label></div>

    <div class="btns">
      <button class="primary" id="save">Save &amp; deploy</button>
      <button id="check">Check availability now</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>

  <div class="card" id="resultCard" style="display:none">
    <div id="resultBody"></div>
  </div>
</div>
<script>
const $=(id)=>document.getElementById(id);
const FIELDS=['minNights','monthsAhead','startOffsetDays','watchStart','watchEnd','weekendsOnly'];
function get(){return{minNights:+$('minNights').value,monthsAhead:+$('monthsAhead').value,startOffsetDays:+$('startOffsetDays').value,watchStart:$('watchStart').value,watchEnd:$('watchEnd').value,weekendsOnly:$('weekendsOnly').checked};}
function set(c){$('minNights').value=c.minNights;$('monthsAhead').value=c.monthsAhead;$('startOffsetDays').value=c.startOffsetDays;$('watchStart').value=c.watchStart||'';$('watchEnd').value=c.watchEnd||'';$('weekendsOnly').checked=!!c.weekendsOnly;}
function msg(t,cls){const m=$('msg');m.textContent=t;m.className='msg '+(cls||'');}
function busy(b){$('save').disabled=b;$('check').disabled=b;}
function fmt(iso){const d=new Date(iso+'T00:00:00');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function renderResult(r){
  const card=$('resultCard'),body=$('resultBody');
  if(!r){card.style.display='none';return;}
  card.style.display='block';
  const ops=r.openings||[];
  if(!ops.length){body.innerHTML='<b>No cabins available</b> for the current settings right now. The watcher will alert you the moment one opens.';return;}
  let h='<b>'+ops.length+' cabin window'+(ops.length>1?'s':'')+' open right now</b> <span class="pill">would alert</span><table><tr><th>Cabin</th><th>Check-in</th><th>Check-out</th><th>Nights</th></tr>';
  for(const o of ops){h+='<tr><td>'+o.unit+(o.isAda?' [ADA]':'')+'</td><td>'+fmt(o.checkIn)+'</td><td>'+fmt(o.checkOut)+'</td><td>'+o.nights+'</td></tr>';}
  h+='</table><div style="margin-top:10px"><a href="https://reserve.floridastateparks.org/Web/#!park/4/12" target="_blank">Open booking site →</a></div>';
  body.innerHTML=h;
}
async function load(){try{const c=await(await fetch('/api/config')).json();set(c);}catch(e){msg('Could not reach the box: '+e,'err');}}
$('save').onclick=async()=>{busy(true);msg('Saving to box…');try{const r=await(await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(get())})).json();if(r.error)throw new Error(r.error);set(r.config);msg('✓ Saved & deployed. Cron will use it within 3 min.','ok');renderResult(r.result);if(r.checkError)msg('Saved, but preview failed: '+r.checkError,'err');}catch(e){msg('Save failed: '+e.message,'err');}busy(false);};
$('check').onclick=async()=>{busy(true);msg('Checking live availability…');try{const r=await(await fetch('/api/check',{method:'POST'})).json();if(r.error)throw new Error(r.error);msg('Checked '+new Date().toLocaleTimeString(),'ok');renderResult(r.result);}catch(e){msg('Check failed: '+e.message,'err');}busy(false);};
load();
</script>
</body></html>`;

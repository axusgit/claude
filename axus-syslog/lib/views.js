'use strict';

// Server-rendered HTML shell. Axus design language: Inter, soft grey bg, solid
// white cards, crisp 1px borders, tight radii, orange accent. The dashboard is a
// static shell filled by client JS that talks to the JSON API + an SSE stream.

const { wordmark: LOGO, favicon: FAVICON } = require('./logo');

const BRAND = process.env.BRAND_NAME || 'Axus Syslog';
const ACCENT = process.env.ACCENT_COLOR || '#f97316';
const ACCENT_HOVER = process.env.ACCENT_HOVER || '#ea580c';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
:root{
  --accent:${ACCENT};
  --accent-hover:${ACCENT_HOVER};
  --bg:#f6f7f9;
  --card:#ffffff;
  --border:#e5e7eb;
  --text:#111827;
  --muted:#6b7280;
  --radius:10px;
  --ok:#16a34a;
  --err:#dc2626;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1240px;margin:0 auto;padding:24px 20px 64px}
.narrow{max-width:440px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px}
.brand .dot{width:22px;height:22px;border-radius:6px;background:var(--accent);display:inline-block}
.brand img{height:34px;width:auto;display:block}
.brand .sep{width:1px;height:24px;background:var(--border)}
.brand .prod{font-weight:600;font-size:16px;color:var(--muted);letter-spacing:.01em}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:22px}
.tab{padding:10px 18px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border:none;background:none;font-family:inherit;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.panel{display:none}
.panel.active{display:block}
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.topbar .right{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:18px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 14px;font-weight:600}
.muted{color:var(--muted);font-size:13px}
label{display:block;font-size:12px;font-weight:500;margin:0 0 5px;color:var(--muted)}
input[type=text],input[type=password],input[type=number],input[type=search],select{
  width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;
  font-size:14px;font-family:inherit;background:#fff;color:var(--text);
}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(249,115,22,.15)}
label.switch{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font-size:14px;font-weight:600;color:var(--text);cursor:pointer;user-select:none;margin:0;box-sizing:border-box}
label.switch input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer;margin:0}
.fieldrow{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px}
.field{display:flex;flex-direction:column}
.btnbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  background:var(--accent);color:#fff;border:none;border-radius:8px;
  padding:9px 15px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;
}
.btn:hover{background:var(--accent-hover);text-decoration:none;color:#fff}
.btn.sm{padding:6px 10px;font-size:12px}
.btn.ghost{background:#fff;color:var(--text);border:1px solid var(--border)}
.btn.ghost:hover{background:#f9fafb;color:var(--text)}
.btn.danger{background:#fff;color:var(--err);border:1px solid var(--border)}
.btn.danger:hover{background:#fef2f2;color:var(--err);border-color:#fecaca}
.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
a.btn:hover{text-decoration:none}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.row>div{min-width:0}
.callout{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:10px 14px;font-size:13px;margin:0 0 16px}
.callout strong{color:#7c2d12}
.flash{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
.flash.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:32px}

/* Stats row */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.stat .n{font-size:24px;font-weight:700;line-height:1.1}
.stat .l{font-size:12px;color:var(--muted);margin-top:2px}

/* Filter bar */
.filters{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px;align-items:end}
.filters .full{grid-column:1/-1}
@media(max-width:820px){.filters{grid-template-columns:1fr 1fr}}

/* Live toggle */
.live{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;cursor:pointer;user-select:none}
.live .led{width:9px;height:9px;border-radius:50%;background:#cbd5e1;transition:background .2s}
.live.on .led{background:var(--ok);box-shadow:0 0 0 3px rgba(22,163,74,.18);animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* Log table */
.logwrap{overflow-x:auto}
table.log{width:100%;border-collapse:collapse;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
table.log th{text-align:left;padding:8px;border-bottom:1px solid var(--border);color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-family:Inter,sans-serif;position:sticky;top:0;background:var(--card)}
table.log td{padding:7px 8px;border-bottom:1px solid #f1f2f4;vertical-align:top}
table.log tr:hover td{background:#fafbfc}
td.time{white-space:nowrap;color:var(--muted)}
td.host{white-space:nowrap;font-weight:600;font-family:Inter,sans-serif}
td.src{white-space:nowrap;color:var(--muted)}
td.app{white-space:nowrap;color:var(--muted)}
td.msg{word-break:break-word;white-space:pre-wrap}
tr.new td{animation:flash-in 1.2s}
@keyframes flash-in{from{background:rgba(249,115,22,.14)}to{background:transparent}}

/* Severity pills */
.sev{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.02em}
.sev.s0,.sev.s1,.sev.s2{background:#fce7e7;color:#991b1b}
.sev.s3{background:#fee2e2;color:#b91c1c}
.sev.s4{background:#fef3c7;color:#92400e}
.sev.s5{background:#e0edff;color:#1e40af}
.sev.s6{background:#dcfce7;color:#166534}
.sev.s7{background:#f3f4f6;color:#6b7280}

.pager{display:flex;align-items:center;gap:12px;justify-content:flex-end;margin-top:14px;font-size:13px;color:var(--muted)}
.empty{color:var(--muted);font-size:14px;padding:36px 0;text-align:center}
.hostbars{display:flex;flex-direction:column;gap:7px;margin-top:4px}
.hostbar{display:grid;grid-template-columns:130px 1fr 54px;gap:10px;align-items:center;font-size:12.5px}
.hostbar .bar{height:8px;background:#eef0f3;border-radius:999px;overflow:hidden}
.hostbar .bar span{display:block;height:100%;background:var(--accent);border-radius:999px}
.hostbar .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hostbar .c{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
`;

function layout({ title, body, extraJs = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="${FAVICON}">
<title>Axus Syslog</title>
<style>${BASE_CSS}</style>
</head>
<body>
${body}
${extraJs ? `<script>${extraJs}</script>` : ''}
</body>
</html>`;
}

function loginPage({ error, user } = {}) {
  const body = `
<div class="wrap narrow" style="padding-top:56px">
  <div class="brand" style="margin-bottom:24px"><img src="${LOGO}" alt="Axus Technologies"><span class="sep"></span><span class="prod">Syslog</span></div>
  <div class="card">
    <h1>Sign in</h1>
    <p class="muted">Admin access — search and monitor incoming syslog.</p>
    ${error ? `<div class="flash err" style="margin-top:16px">${esc(error)}</div>` : ''}
    <form method="post" action="/login">
      <div style="margin-top:14px"><label>Username</label>
      <input type="text" name="username" autocomplete="username" value="${esc(user || '')}" autofocus></div>
      <div style="margin-top:14px"><label>Password</label>
      <input type="password" name="password" autocomplete="current-password"></div>
      <button class="btn" style="margin-top:20px;width:100%" type="submit">Sign in</button>
    </form>
  </div>
  <div class="foot">Protected area · ${esc(BRAND)}</div>
</div>`;
  return layout({ title: 'Sign in', body });
}

function dashboardPage() {
  const body = `
<div class="wrap">
  <div class="topbar">
    <div class="brand"><img src="${LOGO}" alt="Axus Technologies"><span class="sep"></span><span class="prod">Syslog</span></div>
    <div class="right">
      <span id="ingest" class="muted"></span>
      <a href="/logout">Sign out</a>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="messages">Messages</button>
    <button class="tab" data-tab="firewall">Firewall</button>
    <button class="tab" data-tab="watchdog">Watchdog</button>
  </div>

  <div class="panel active" id="panel-messages">
  <div class="stats" id="stats"></div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">
      <h2 style="margin:0">Messages</h2>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="muted" style="font-size:12px;white-space:nowrap" title="Logs older than 7 days are removed automatically">Auto-clears after 7 days</span>
        <div style="display:flex;align-items:center;gap:6px">
          <select id="fmt" style="width:auto;padding:6px 9px;font-size:13px">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="txt">Text</option>
          </select>
          <button class="btn ghost sm" id="download" title="Download all messages matching the current filters">↓ Download</button>
        </div>
        <label class="live" id="liveToggle"><span class="led"></span><span>Live tail</span></label>
      </div>
    </div>
    <div class="filters">
      <div class="full" style="grid-column:1/3"><label>Search text</label>
        <input type="search" id="q" placeholder="message, host, app, IP…"></div>
      <div><label>Host</label><select id="host"><option value="">All hosts</option></select></div>
      <div><label>Min severity</label><select id="sev">
        <option value="">All</option>
        <option value="0">Emergency</option>
        <option value="1">Alert</option>
        <option value="2">Critical</option>
        <option value="3">Error</option>
        <option value="4">Warning</option>
        <option value="5">Notice</option>
        <option value="6">Informational</option>
        <option value="7">Debug</option>
      </select></div>
      <div><label>Range</label><select id="range">
        <option value="0.0166667">Last 1 minute</option>
        <option value="0.166667">Last 10 minutes</option>
        <option value="1">Last hour</option>
        <option value="4">Last 4h</option>
        <option value="12">Last 12h</option>
        <option value="18">Last 18h</option>
        <option value="24" selected>Last 24h</option>
        <option value="168">Last 7 days</option>
        <option value="custom">Custom range…</option>
      </select></div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="apply">Search</button>
        <button class="btn ghost" id="reset">Reset</button>
      </div>
      <div id="customRange" class="full" style="display:none">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:180px"><label>From</label><input type="datetime-local" id="from" step="1"></div>
          <div style="flex:1;min-width:180px"><label>To</label><input type="datetime-local" id="to" step="1"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="logwrap">
      <table class="log">
        <thead><tr>
          <th style="width:150px">Time</th>
          <th style="width:90px">Severity</th>
          <th style="width:130px">Host</th>
          <th style="width:115px">Source IP</th>
          <th style="width:115px">Private IP</th>
          <th style="width:110px">App</th>
          <th>Message</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <div class="empty" id="empty" style="display:none">No messages match.</div>
    </div>
    <div class="pager">
      <span id="count"></span>
      <button class="btn ghost sm" id="prev">‹ Newer</button>
      <button class="btn ghost sm" id="next">Older ›</button>
    </div>
  </div>

  <div class="card">
    <h2>Top sources (last 24h)</h2>
    <div class="hostbars" id="hosts"></div>
    <div class="empty" id="hostsEmpty" style="display:none">No traffic yet.</div>
  </div>
  </div><!-- /panel-messages -->

  <div class="panel" id="panel-firewall">
  <div class="card">
    <h2>Firewall — allowed syslog sources (UDP ${esc(String(process.env.SYSLOG_UDP_PORT || 514))})</h2>
    <p class="muted" style="margin-top:-6px">
      Host firewall (ufw) rules for the ingest port. Syslog is unauthenticated —
      restrict it to your device IPs.
    </p>
    <div class="callout">
      <strong>Heads up:</strong> the IPs below must <em>also</em> be allowed on the
      AWS VM firewall (Lightsail security group) — that's the outer gate. Having
      both layers is redundant, but that's fine.
    </div>
    <div id="fwFlash"></div>
    <div class="row" style="align-items:end;max-width:720px">
      <div style="flex:2"><label>Add source (IP or CIDR)</label>
        <input type="text" id="fwSrc" placeholder="e.g. 203.0.113.10 or 10.0.0.0/24"></div>
      <div style="flex:2"><label>Name / owner</label>
        <input type="text" id="fwName" placeholder="e.g. Main office firewall" maxlength="60"></div>
      <div style="flex:0"><button class="btn" id="fwAdd">Allow</button></div>
    </div>
    <div class="logwrap" style="margin-top:14px">
      <table class="log" style="font-family:Inter,sans-serif;font-size:13px">
        <thead><tr><th style="width:170px">Source</th><th style="width:80px">Action</th><th>Name / owner</th><th style="width:90px"></th></tr></thead>
        <tbody id="fwRows"></tbody>
      </table>
      <div class="empty" id="fwEmpty" style="display:none">No rules for this port yet.</div>
      <div class="empty" id="fwInactive" style="display:none">ufw is inactive on this host.</div>
    </div>
  </div>
  </div><!-- /panel-firewall -->

  <div class="panel" id="panel-watchdog">
  <div class="card">
    <h2 style="margin:0 0 4px">Watchdog</h2>
    <p class="muted" style="margin:0 0 18px">Alerts via ntfy if <strong>no syslog is received</strong> for the selected time — catches the phones going down, losing service, or a network drop. A recovery alert fires when logs resume.</p>
    <div id="wdFlash"></div>
    <div class="fieldrow">
      <div class="field">
        <label>Alerting</label>
        <label class="switch"><input type="checkbox" id="wdEnabled"><span>Enabled</span></label>
      </div>
      <div class="field">
        <label>Check window</label>
        <select id="wdSec" style="width:190px">
          <option value="60">60 seconds</option>
          <option value="120">120 seconds</option>
          <option value="180">3 minutes</option>
          <option value="300">5 minutes</option>
          <option value="600">10 minutes</option>
        </select>
      </div>
    </div>
    <div class="btnbar">
      <button class="btn" id="wdSave">Save</button>
      <button class="btn ghost" id="wdTest" title="Send a test notification to your ntfy topic">Send test alert</button>
    </div>
    <p class="muted" id="wdStatus" style="margin:16px 0 0"></p>
  </div>

  <div class="card">
    <h2 style="margin:0 0 4px">Clear logs</h2>
    <p class="muted" style="margin:0 0 18px">Logs auto-clear after <strong>7 days</strong>. To free space sooner, manually remove anything older than a shorter window:</p>
    <div id="clFlash"></div>
    <div class="fieldrow">
      <div class="field">
        <label>Delete logs older than</label>
        <select id="clDays" style="width:160px">
          <option value="1">1 day</option>
          <option value="3">3 days</option>
          <option value="5">5 days</option>
          <option value="7">7 days</option>
        </select>
      </div>
      <div class="field"><button class="btn danger" id="clRun">Clear now</button></div>
    </div>
  </div>
  </div><!-- /panel-watchdog -->

  <div class="foot">${esc(BRAND)} · UDP syslog collector</div>
</div>`;
  return layout({ title: 'Dashboard', body, extraJs: CLIENT_JS });
}

// ------------------------------- client JS -------------------------------
const CLIENT_JS = `
const SEV=['Emergency','Alert','Critical','Error','Warning','Notice','Informational','Debug'];
const $=id=>document.getElementById(id);
let offset=0, limit=200, live=false, es=null, lastMaxId=0;

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtTime(ms){const d=new Date(ms);return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
function fmtNum(n){return (n||0).toLocaleString('en-US');}
function fmtBytes(n){n=n||0;const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return n.toFixed(n<10&&i>0?1:0)+' '+u[i];}

function filters(){
  const f={limit,offset};
  const q=$('q').value.trim(); if(q)f.q=q;
  if($('host').value)f.host=$('host').value;
  if($('sev').value!=='')f.maxSeverity=$('sev').value;
  const rv=$('range').value;
  if(rv==='custom'){
    const from=$('from').value, to=$('to').value;   // datetime-local = viewer local time
    if(from){const t=Date.parse(from); if(!isNaN(t))f.since=t;}
    if(to){const t=Date.parse(to); if(!isNaN(t))f.until=t;}
  } else {
    const h=Number(rv); if(h>0)f.since=Date.now()-h*3600000;
  }
  return f;
}
function qs(o){return Object.entries(o).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');}

function privIP(text){
  const ips=String(text||'').match(/\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/g)||[];
  for(const ip of ips){const o=ip.split('.').map(Number);if(o.some(n=>n>255))continue;
    if(o[0]===10||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168))return ip;}
  return '';
}
function rowHtml(m,isNew){
  const sev=m.severity==null?7:m.severity;
  const srcip=m.source_ip||m.sourceIp||'';   // API uses source_ip, live tail uses sourceIp
  const host=m.host||srcip||'—';
  const priv=privIP(m.message);
  const app=[m.app,m.procid&&('['+m.procid+']')].filter(Boolean).join('');
  return '<tr'+(isNew?' class="new"':'')+'>'+
    '<td class="time">'+esc(fmtTime(m.ts))+'</td>'+
    '<td><span class="sev s'+sev+'">'+esc(SEV[sev]||sev)+'</span></td>'+
    '<td class="host">'+esc(host)+'</td>'+
    '<td class="src">'+esc(srcip||'—')+'</td>'+
    '<td class="src">'+esc(priv||'—')+'</td>'+
    '<td class="app">'+esc(app||'—')+'</td>'+
    '<td class="msg">'+esc(m.message||'')+'</td></tr>';
}

async function load(){
  const res=await fetch('/api/messages?'+qs(filters()));
  if(res.status===401){location.href='/login';return;}
  const data=await res.json();
  const rows=$('rows'), empty=$('empty');
  rows.innerHTML=data.rows.map(m=>rowHtml(m,false)).join('');
  empty.style.display=data.rows.length?'none':'block';
  if(data.rows.length)lastMaxId=data.rows[0].id;
  const from=data.total?offset+1:0, to=offset+data.rows.length;
  $('count').textContent=fmtNum(from)+'–'+fmtNum(to)+' of '+fmtNum(data.total);
  $('prev').disabled=offset<=0;
  $('next').disabled=to>=data.total;
}

async function loadStats(){
  const res=await fetch('/api/stats'); if(!res.ok)return;
  const s=await res.json();
  $('stats').innerHTML=[
    ['Total messages',fmtNum(s.total)],
    ['Last 24 hours',fmtNum(s.last24)],
    ['Last hour',fmtNum(s.lastHour)],
    ['Errors (24h)',fmtNum(s.errors24)],
    ['Active sources',fmtNum(s.topHosts.length)],
    ['Log storage',fmtBytes(s.dbBytes)],
  ].map(([l,n])=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
  const hb=$('hosts'), max=Math.max(1,...s.topHosts.map(h=>h.c));
  hb.innerHTML=s.topHosts.map(h=>'<div class="hostbar"><span class="name" title="'+esc(h.name)+'">'+esc(h.name)+
    '</span><span class="bar"><span style="width:'+(h.c/max*100)+'%"></span></span><span class="c">'+fmtNum(h.c)+'</span></div>').join('');
  $('hostsEmpty').style.display=s.topHosts.length?'none':'block';
  $('ingest').textContent='Ingest: '+fmtNum(s.received)+' pkts';
}

async function loadHosts(){
  const res=await fetch('/api/facets'); if(!res.ok)return;
  const f=await res.json(), sel=$('host'), cur=sel.value;
  sel.innerHTML='<option value="">All hosts</option>'+f.hosts.map(h=>'<option>'+esc(h)+'</option>').join('');
  sel.value=cur;
}

function matchesFilters(m){
  const q=$('q').value.trim().toLowerCase();
  if(q){const hay=((m.message||'')+' '+(m.host||'')+' '+(m.app||'')+' '+(m.source_ip||'')).toLowerCase();if(!hay.includes(q))return false;}
  if($('host').value){const name=m.host||m.source_ip;if(name!==$('host').value)return false;}
  if($('sev').value!==''&&m.severity>Number($('sev').value))return false;
  if($('range').value==='custom'){
    const from=$('from').value, to=$('to').value;
    if(from){const t=Date.parse(from); if(!isNaN(t)&&m.ts<t)return false;}
    if(to){const t=Date.parse(to); if(!isNaN(t)&&m.ts>t)return false;}
  }
  return true;
}

function setLive(on){
  live=on;
  const t=$('liveToggle'); t.classList.toggle('on',on);
  if(on){
    offset=0;
    es=new EventSource('/api/stream');
    es.onmessage=e=>{
      const m=JSON.parse(e.data);
      if(!matchesFilters(m))return;
      const rows=$('rows'); $('empty').style.display='none';
      rows.insertAdjacentHTML('afterbegin',rowHtml(m,true));
      while(rows.children.length>limit)rows.removeChild(rows.lastChild);
    };
    es.onerror=()=>{/* browser auto-reconnects */};
  }else if(es){es.close();es=null;load();}
}

$('apply').onclick=()=>{offset=0;load();};
$('reset').onclick=()=>{$('q').value='';$('host').value='';$('sev').value='';$('range').value='24';$('from').value='';$('to').value='';$('customRange').style.display='none';offset=0;load();};
$('q').addEventListener('keydown',e=>{if(e.key==='Enter'){offset=0;load();}});
$('next').onclick=()=>{offset+=limit;load();};
$('prev').onclick=()=>{offset=Math.max(0,offset-limit);load();};
$('liveToggle').onclick=()=>setLive(!live);
[$('host'),$('sev')].forEach(el=>el.onchange=()=>{offset=0;load();});
// Range: presets apply immediately; "Custom range…" reveals From/To and waits for Search.
$('range').onchange=()=>{
  const custom=$('range').value==='custom';
  $('customRange').style.display=custom?'block':'none';
  offset=0;
  if(!custom)load();
};
['from','to'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter'){offset=0;load();}}));

// ---- download / export ----
$('download').onclick=()=>{
  const f=filters(); delete f.limit; delete f.offset;
  f.format=$('fmt').value; f.order='asc';
  window.location.href='/api/export?'+qs(f);
};


// ---- firewall ----
function fwFlash(msg,ok){
  $('fwFlash').innerHTML='<div class="flash '+(ok?'':'err')+'" style="'+(ok?'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534':'')+'">'+esc(msg)+'</div>';
  if(ok)setTimeout(()=>{$('fwFlash').innerHTML='';},4000);
}
function renderFw(data){
  $('fwInactive').style.display=data.active?'none':'block';
  const rows=$('fwRows'), list=data.rules||[];
  $('fwEmpty').style.display=(data.active&&!list.length)?'block':'none';
  rows.innerHTML=list.map(r=>{
    const src=r.source+(r.v6?' (v6)':'');
    const del=r.v6?'':'<button class="btn danger sm" data-src="'+esc(r.source)+'">Remove</button>';
    return '<tr><td style="font-weight:600">'+esc(src)+'</td><td><span class="sev s6">'+esc(r.action)+
      '</span></td><td class="muted">'+esc(r.comment||'—')+'</td><td>'+del+'</td></tr>';
  }).join('');
  rows.querySelectorAll('button[data-src]').forEach(b=>b.onclick=()=>fwDeny(b.dataset.src));
}
async function loadFirewall(){
  const res=await fetch('/api/firewall'); if(res.status===401){location.href='/login';return;}
  if(!res.ok)return; renderFw(await res.json());
}
async function fwAdd(){
  const src=$('fwSrc').value.trim(); if(!src)return;
  const name=$('fwName').value.trim();
  const res=await fetch('/api/firewall/allow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:src,name})});
  const d=await res.json();
  if(res.ok){$('fwSrc').value='';$('fwName').value='';fwFlash('Allowed '+d.source,true);renderFw(d);}
  else fwFlash(d.error||'Failed',false);
}
async function fwDeny(src){
  if(!confirm('Remove firewall rule for '+src+'?'))return;
  const res=await fetch('/api/firewall/deny',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:src})});
  const d=await res.json();
  if(res.ok){fwFlash('Removed '+d.source,true);renderFw(d);}
  else fwFlash(d.error||'Failed',false);
}
$('fwAdd').onclick=fwAdd;
['fwSrc','fwName'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')fwAdd();}));

// ---- watchdog ----
function wdFlash(msg,ok){$('wdFlash').innerHTML='<div class="flash '+(ok?'':'err')+'" style="'+(ok?'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534':'')+'">'+esc(msg)+'</div>';if(ok)setTimeout(()=>{$('wdFlash').innerHTML='';},4000);}
async function loadWatchdog(){
  const res=await fetch('/api/watchdog'); if(res.status===401){location.href='/login';return;} if(!res.ok)return;
  const d=await res.json();
  $('wdEnabled').checked=!!d.enabled;
  $('wdSec').value=String(d.sec);
  let st='Last message '+ (d.lastMessageAgeSec<120? d.lastMessageAgeSec+'s':Math.round(d.lastMessageAgeSec/60)+'m') +' ago.';
  if(!d.topicConfigured)st+=' ⚠ No ntfy topic configured — alerts cannot be sent.';
  $('wdStatus').textContent=st;
}
$('wdSave').onclick=async()=>{
  const enabled=$('wdEnabled').checked, sec=Number($('wdSec').value);
  const res=await fetch('/api/watchdog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,sec})});
  const d=await res.json().catch(()=>({}));
  if(res.ok)wdFlash('Saved — watchdog '+(d.enabled?'ON, alert after '+d.sec+'s of silence':'OFF'),true);
  else wdFlash(d.error||'Save failed',false);
  loadWatchdog();
};
$('wdTest').onclick=async()=>{
  $('wdTest').disabled=true; wdFlash('Sending test alert…',true);
  let d={}; try{const res=await fetch('/api/alert/test',{method:'POST'});d=await res.json().catch(()=>({}));d._ok=res.ok;}catch(e){d={error:e.message};}
  $('wdTest').disabled=false;
  if(d._ok)wdFlash('Test alert sent ✓ — check your phone (ntfy).',true);
  else wdFlash('Test failed: '+(d.error||'unknown'),false);
};

// ---- clear logs ----
function clFlash(msg,ok){$('clFlash').innerHTML='<div class="flash '+(ok?'':'err')+'" style="'+(ok?'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534':'')+'">'+esc(msg)+'</div>';if(ok)setTimeout(()=>{$('clFlash').innerHTML='';},5000);}
$('clRun').onclick=async()=>{
  const days=Number($('clDays').value);
  if(!confirm('Delete all logs older than '+days+' day(s)?\\n\\nThis permanently removes those messages now and cannot be undone.'))return;
  $('clRun').disabled=true;
  const res=await fetch('/api/clearlogs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days})});
  const d=await res.json().catch(()=>({}));
  $('clRun').disabled=false;
  if(res.ok){clFlash('Cleared '+fmtNum(d.deleted)+' message(s) older than '+days+' day(s).',true);loadStats();if(!live)load();}
  else clFlash(d.error||'Clear failed',false);
};

// ---- tabs ----
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('panel-'+t.dataset.tab).classList.add('active');
  if(t.dataset.tab==='firewall')loadFirewall();
  if(t.dataset.tab==='watchdog')loadWatchdog();
});

load();loadStats();loadHosts();loadFirewall();
setInterval(()=>{loadStats();loadHosts();},15000);
setInterval(()=>{if(!live)load();},15000);
`;

module.exports = { loginPage, dashboardPage, esc };

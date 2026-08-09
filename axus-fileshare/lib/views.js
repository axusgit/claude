'use strict';

// Server-rendered HTML. No build step. Axus design language:
// Inter, soft grey bg, solid white cards, crisp 1px borders, tight radii,
// orange accent.

const BRAND = process.env.BRAND_NAME || 'Axus File Share';
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

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 64px}
.narrow{max-width:440px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;margin-bottom:24px}
.brand .dot{width:22px;height:22px;border-radius:6px;background:var(--accent);display:inline-block}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 14px;font-weight:600}
.muted{color:var(--muted);font-size:13px}
label{display:block;font-size:13px;font-weight:500;margin:14px 0 6px}
input[type=text],input[type=password],input[type=number],select,textarea{
  width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;
  font-size:14px;font-family:inherit;background:#fff;color:var(--text);
}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(249,115,22,.15)}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row>div{flex:1;min-width:140px}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  background:var(--accent);color:#fff;border:none;border-radius:8px;
  padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;
}
.btn:hover{background:var(--accent-hover);text-decoration:none;color:#fff}
.btn.sm{padding:6px 10px;font-size:12px}
.btn.ghost{background:#fff;color:var(--text);border:1px solid var(--border)}
.btn.ghost:hover{background:#f9fafb;color:var(--text)}
.btn.danger{background:#fff;color:var(--err);border:1px solid var(--border)}
.btn.danger:hover{background:#fef2f2;color:var(--err)}
.actions{display:flex;gap:6px;align-items:center}
.actions form{display:inline;margin:0}
.btn.pill{border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600}
.btn.enable{background:var(--ok);color:#fff}
.btn.enable:hover{background:#15803d;color:#fff}
.btn.disable{background:#fff;color:var(--muted);border:1px solid var(--border)}
.btn.disable:hover{background:#fef2f2;color:var(--err);border-color:#fecaca}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.pill.ok{background:#dcfce7;color:#166534}
.pill.off{background:#f3f4f6;color:#6b7280}
.pill.warn{background:#fef3c7;color:#92400e}
.linkbox{display:flex;gap:8px;align-items:center;margin-top:8px}
.linkbox input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.flash{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
.flash.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.flash.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.empty{color:var(--muted);font-size:14px;padding:24px 0;text-align:center}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:32px}
`;

function layout({ title, body, extraCss = '', extraJs = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(BRAND)}</title>
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
${body}
${extraJs ? `<script>${extraJs}</script>` : ''}
</body>
</html>`;
}

function loginPage({ error, user }) {
  const body = `
<div class="wrap narrow">
  <div class="brand"><span class="dot"></span>${esc(BRAND)}</div>
  <div class="card">
    <h1>Sign in</h1>
    <p class="muted">Admin access — manage upload links and files.</p>
    ${error ? `<div class="flash err" style="margin-top:16px">${esc(error)}</div>` : ''}
    <form method="post" action="/admin/login">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" value="${esc(user || '')}" autofocus>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password">
      <button class="btn" style="margin-top:20px;width:100%" type="submit">Sign in</button>
    </form>
  </div>
  <div class="foot">Protected area · ${esc(BRAND)}</div>
</div>`;
  return layout({ title: 'Sign in', body });
}

function linkRow(link, baseUrl, statusOf) {
  const st = statusOf(link);
  let pill;
  if (st.ok) pill = '<span class="pill ok">Active</span>';
  else if (st.reason === 'revoked') pill = '<span class="pill off">Revoked</span>';
  else if (st.reason === 'expired') pill = '<span class="pill warn">Expired</span>';
  else if (st.reason === 'maxed') pill = '<span class="pill warn">Limit reached</span>';
  else pill = '<span class="pill off">Inactive</span>';

  const url = `${baseUrl}/u/${link.token}`;
  const limit = link.maxUses ? `${link.uploads.length}/${link.maxUses}` : `${link.uploads.length}`;
  return `
<tr>
  <td>
    <div style="font-weight:600">${esc(link.label || 'Untitled link')}</div>
    ${link.note ? `<div class="muted">${esc(link.note)}</div>` : ''}
    <div class="linkbox">
      <input type="text" readonly value="${esc(url)}" onclick="this.select()" id="lk_${esc(link.id)}">
      <button class="btn sm ghost" type="button" onclick="copyLink('lk_${esc(link.id)}',this)">Copy</button>
    </div>
  </td>
  <td>${pill}</td>
  <td>${esc(limit)} file(s)</td>
  <td>${link.expiresAt ? fmtDate(link.expiresAt) : 'No expiry'}</td>
  <td style="white-space:nowrap">
    <div class="actions">
      ${
        link.revoked
          ? `<form method="post" action="/admin/links/${esc(link.id)}/enable">
               <button class="btn pill enable" type="submit">Enable</button>
             </form>`
          : `<form method="post" action="/admin/links/${esc(link.id)}/revoke">
               <button class="btn pill disable" type="submit">Disable</button>
             </form>`
      }
      <a class="btn sm ghost" href="/admin/links/${esc(link.id)}/edit">Edit</a>
      <form method="post" action="/admin/links/${esc(link.id)}/delete" onsubmit="return confirm('Delete this link and all files uploaded through it? This cannot be undone.')">
        <button class="btn sm danger" type="submit">Del</button>
      </form>
    </div>
  </td>
</tr>`;
}

function fileRows(links) {
  const rows = [];
  for (const link of links) {
    for (const up of link.uploads) {
      rows.push({ link, up });
    }
  }
  rows.sort((a, b) => (b.up.uploadedAt || 0) - (a.up.uploadedAt || 0));
  if (!rows.length) {
    return `<tr><td colspan="5"><div class="empty">No files uploaded yet.</div></td></tr>`;
  }
  return rows
    .map(
      ({ link, up }) => `
<tr>
  <td>
    <div style="font-weight:600;word-break:break-all">${esc(up.originalName)}</div>
    <div class="muted">via “${esc(link.label || 'Untitled link')}”</div>
  </td>
  <td>${esc(up.uploaderName || '—')}</td>
  <td style="white-space:nowrap">${fmtBytes(up.size)}</td>
  <td style="white-space:nowrap">${fmtDate(up.uploadedAt)}</td>
  <td style="white-space:nowrap">
    <a class="btn sm ghost" href="/admin/files/${esc(link.token)}/${encodeURIComponent(up.storedName)}">Download</a>
    <form method="post" action="/admin/files/${esc(link.token)}/${encodeURIComponent(up.storedName)}/share" style="display:inline" onsubmit="return confirm('Create a public download link for this file? Anyone with the link will be able to download it.')">
      <button class="btn sm ghost" type="submit">Share</button>
    </form>
    <form method="post" action="/admin/files/${esc(link.token)}/${encodeURIComponent(up.storedName)}/delete" style="display:inline" onsubmit="return confirm('Delete this file permanently?')">
      <button class="btn sm danger" type="submit">Delete</button>
    </form>
  </td>
</tr>`
    )
    .join('');
}

function sendRow(send, baseUrl, sendStatusOf) {
  const st = sendStatusOf(send);
  let pill;
  if (st.ok) pill = '<span class="pill ok">Active</span>';
  else if (st.reason === 'revoked') pill = '<span class="pill off">Revoked</span>';
  else if (st.reason === 'expired') pill = '<span class="pill warn">Expired</span>';
  else if (st.reason === 'maxed') pill = '<span class="pill warn">Limit reached</span>';
  else pill = '<span class="pill off">Inactive</span>';

  const url = `${baseUrl}/d/${send.token}`;
  const dl = send.maxDownloads
    ? `${send.downloadCount || 0}/${send.maxDownloads}`
    : `${send.downloadCount || 0}`;
  const names = send.files.map((f) => f.originalName).join(', ');
  const namesShort = names.length > 90 ? names.slice(0, 90) + '…' : names;
  return `
<tr>
  <td>
    <div style="font-weight:600">${esc(send.label || 'Shared files')}</div>
    ${send.note ? `<div class="muted">${esc(send.note)}</div>` : ''}
    <div class="muted">${send.files.length} file(s): ${esc(namesShort)}</div>
    <div class="linkbox">
      <input type="text" readonly value="${esc(url)}" onclick="this.select()" id="sk_${esc(send.id)}">
      <button class="btn sm ghost" type="button" onclick="copyLink('sk_${esc(send.id)}',this)">Copy</button>
    </div>
  </td>
  <td>${pill}</td>
  <td>${esc(dl)} download(s)</td>
  <td>${send.expiresAt ? fmtDate(send.expiresAt) : 'No expiry'}</td>
  <td style="white-space:nowrap">
    <div class="actions">
      ${
        send.revoked
          ? `<form method="post" action="/admin/sends/${esc(send.id)}/enable">
               <button class="btn pill enable" type="submit">Enable</button>
             </form>`
          : `<form method="post" action="/admin/sends/${esc(send.id)}/revoke">
               <button class="btn pill disable" type="submit">Disable</button>
             </form>`
      }
      <form method="post" action="/admin/sends/${esc(send.id)}/delete" onsubmit="return confirm('Delete this download link and its files? This cannot be undone.')">
        <button class="btn sm danger" type="submit">Del</button>
      </form>
    </div>
  </td>
</tr>`;
}

function adminPage({ links, sends = [], baseUrl, statusOf, sendStatusOf, flash, maxUploadMb }) {
  const activeCount = links.filter((l) => statusOf(l).ok).length;
  const fileCount = links.reduce((n, l) => n + l.uploads.length, 0);
  const activeSends = sends.filter((s) => sendStatusOf(s).ok).length;
  const body = `
<div class="wrap">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:24px">
    <div class="brand" style="margin:0"><span class="dot"></span>${esc(BRAND)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn ghost sm" href="/admin/manual">Manual</a>
      <a class="btn ghost sm" href="/admin/architecture">Architecture</a>
      <a class="btn ghost sm" href="/admin/logout">Sign out</a>
    </div>
  </div>

  ${flash ? `<div class="flash ${flash.type === 'err' ? 'err' : 'ok'}">${esc(flash.msg)}</div>` : ''}

  <div class="card">
    <h2>Create an upload link</h2>
    <p class="muted">Generate a secret link to send someone. They can upload without a password. Set an expiry or a file limit if you want it to be one-time.</p>
    <form method="post" action="/admin/links">
      <label>Label <span class="muted">(so you remember who / what it's for)</span></label>
      <input type="text" name="label" placeholder="e.g. Tax docs from Jane" required>
      <div class="row">
        <div>
          <label>Expires in</label>
          <select name="expiresIn">
            <option value="">Never</option>
            <option value="1">1 hour</option>
            <option value="24" selected>24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </div>
        <div>
          <label>Max files <span class="muted">(blank = unlimited)</span></label>
          <input type="number" name="maxUses" min="1" placeholder="Unlimited">
        </div>
      </div>
      <label>Note to uploader <span class="muted">(optional, shown on the page)</span></label>
      <input type="text" name="note" placeholder="e.g. Please upload the signed PDF and photo ID.">
      <button class="btn" style="margin-top:18px" type="submit">Create link</button>
    </form>
  </div>

  <div class="card">
    <h2>Upload links <span class="muted">· ${activeCount} active</span></h2>
    ${
      links.length
        ? `<table>
            <thead><tr><th>Link</th><th>Status</th><th>Uploaded</th><th>Expires</th><th></th></tr></thead>
            <tbody>${links.map((l) => linkRow(l, baseUrl, statusOf)).join('')}</tbody>
           </table>`
        : `<div class="empty">No links yet. Create one above.</div>`
    }
  </div>

  <div class="card">
    <h2>Received files <span class="muted">· ${fileCount} total</span></h2>
    <table>
      <thead><tr><th>File</th><th>From</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>${fileRows(links)}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Send a file <span class="muted">(create a download link)</span></h2>
    <p class="muted">Upload one or more files and get a secret link to send someone so <strong>they can download them</strong> — no account needed on their end. Set an expiry or a download limit for one-time use.</p>
    <form id="sendForm" onsubmit="return false">
      <label>Label <span class="muted">(so you remember what it is / who it's for)</span></label>
      <input type="text" id="sLabel" placeholder="e.g. Signed contract for Jane" required>
      <div class="row">
        <div>
          <label>Expires in</label>
          <select id="sExpires">
            <option value="">Never</option>
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
            <option value="72" selected>3 days</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </div>
        <div>
          <label>Max downloads <span class="muted">(blank = unlimited)</span></label>
          <input type="number" id="sMax" min="1" placeholder="Unlimited">
        </div>
      </div>
      <label>Note to recipient <span class="muted">(optional, shown on the page)</span></label>
      <input type="text" id="sNote" placeholder="e.g. Here's the signed PDF you asked for.">
      <label>Files</label>
      <div id="sDrop" class="drop">
        <input type="file" id="sFiles" multiple hidden>
        <div class="dropinner">
          <strong>Drag &amp; drop files here</strong>
          <div class="muted">or <a href="#" id="sBrowse">browse to choose</a></div>
        </div>
      </div>
      <div id="sList"></div>
      <button class="btn" id="sGo" style="margin-top:18px" disabled>Create download link</button>
      <div id="sProg" class="progwrap" style="display:none"><div id="sBar" class="progbar"></div></div>
      <div id="sMsg"></div>
    </form>
  </div>

  <div class="card">
    <h2>Download links <span class="muted">· ${activeSends} active</span></h2>
    ${
      sends.length
        ? `<table>
            <thead><tr><th>Link</th><th>Status</th><th>Downloads</th><th>Expires</th><th></th></tr></thead>
            <tbody>${sends.map((s) => sendRow(s, baseUrl, sendStatusOf)).join('')}</tbody>
           </table>`
        : `<div class="empty">No download links yet. Send a file above.</div>`
    }
  </div>

  <div class="foot">${maxUploadMb > 0 ? `Max upload size: ${maxUploadMb} MB per file · ` : 'No upload size limit · '}${esc(BRAND)}</div>
</div>`;

  const css = `
.drop{border:2px dashed var(--border);border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:.15s;margin-top:6px}
.drop.hover{border-color:var(--accent);background:#fff7ed}
.dropinner strong{display:block;margin-bottom:4px}
.filerow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.filerow:last-child{border-bottom:none}
.filerow .rm{color:var(--err);cursor:pointer;font-size:12px}
.progwrap{height:8px;background:#f3f4f6;border-radius:999px;margin-top:14px;overflow:hidden}
.progbar{height:100%;width:0;background:var(--accent);transition:width .2s}
#sMsg .flash{margin-top:14px}
`;

  const js = `
function copyLink(id,btn){
  var el=document.getElementById(id);
  el.select();
  navigator.clipboard.writeText(el.value).then(function(){
    var t=btn.textContent;btn.textContent='Copied';
    setTimeout(function(){btn.textContent=t},1500);
  }).catch(function(){document.execCommand('copy');});
}
// --- Send-a-file uploader (creates an outbound download link) ---
(function(){
  var drop=document.getElementById('sDrop');
  if(!drop)return;
  var maxBytes=${Number(maxUploadMb) > 0 ? Number(maxUploadMb) * 1024 * 1024 : 0};
  var picked=[];
  var input=document.getElementById('sFiles');
  var list=document.getElementById('sList');
  var go=document.getElementById('sGo');
  var msg=document.getElementById('sMsg');
  function fmt(n){var u=['B','KB','MB','GB'],i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toFixed(i?1:0)+' '+u[i];}
  function render(){
    list.innerHTML='';
    picked.forEach(function(f,idx){
      var over=maxBytes>0&&f.size>maxBytes;
      var row=document.createElement('div');row.className='filerow';
      row.innerHTML='<span>'+f.name.replace(/[<>&]/g,'')+' <span class="muted">'+fmt(f.size)+(over?' — too large':'')+'</span></span>';
      var rm=document.createElement('span');rm.className='rm';rm.textContent='Remove';
      rm.onclick=function(){picked.splice(idx,1);render();};
      row.appendChild(rm);
      if(over)row.style.color='var(--err)';
      list.appendChild(row);
    });
    var anyOver=maxBytes>0&&picked.some(function(f){return f.size>maxBytes;});
    go.disabled=picked.length===0||anyOver;
  }
  function addFiles(fl){for(var i=0;i<fl.length;i++)picked.push(fl[i]);render();}
  document.getElementById('sBrowse').onclick=function(e){e.preventDefault();input.click();};
  drop.onclick=function(){input.click();};
  input.onchange=function(){addFiles(input.files);input.value='';};
  ['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('hover');});});
  ['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('hover');});});
  drop.addEventListener('drop',function(e){addFiles(e.dataTransfer.files);});
  go.onclick=function(){
    var label=(document.getElementById('sLabel').value||'').trim();
    if(!label){msg.innerHTML='<div class="flash err">Please add a label.</div>';return;}
    if(!picked.length)return;
    go.disabled=true;go.textContent='Uploading…';msg.innerHTML='';
    var fd=new FormData();
    fd.append('label',label);
    fd.append('note',document.getElementById('sNote').value||'');
    fd.append('expiresIn',document.getElementById('sExpires').value||'');
    fd.append('maxDownloads',document.getElementById('sMax').value||'');
    picked.forEach(function(f){fd.append('files',f,f.name);});
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/admin/sends',true);
    var pw=document.getElementById('sProg');var bar=document.getElementById('sBar');pw.style.display='block';
    xhr.upload.onprogress=function(e){if(e.lengthComputable){bar.style.width=(e.loaded/e.total*100).toFixed(0)+'%';}};
    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300){
        var url='';try{url=JSON.parse(xhr.responseText).url||'';}catch(e){}
        var safe=url.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
        msg.innerHTML='<div class="flash ok">Download link created — copy it and send it to the recipient:</div>'+
          '<div class="linkbox"><input type="text" readonly id="newSendLink" value="'+safe+'" onclick="this.select()"><button class="btn sm ghost" type="button" onclick="copyLink(\\'newSendLink\\',this)">Copy</button></div>'+
          '<p class="muted" style="margin-top:10px"><a href="/admin">Refresh</a> to see it in the list below.</p>';
        picked=[];render();pw.style.display='none';go.style.display='none';drop.style.display='none';
      }else{
        var t='Upload failed. Please try again.';try{t=JSON.parse(xhr.responseText).error||t;}catch(e){}
        msg.innerHTML='<div class="flash err">'+t.replace(/[<>&]/g,'')+'</div>';
        go.disabled=false;go.textContent='Create download link';pw.style.display='none';
      }
    };
    xhr.onerror=function(){msg.innerHTML='<div class="flash err">Network error. Please try again.</div>';go.disabled=false;go.textContent='Create download link';pw.style.display='none';};
    xhr.send(fd);
  };
  render();
})();`;
  return layout({ title: 'Admin', body, extraCss: css, extraJs: js });
}

function editPage({ link, flash }) {
  const currentExpiry = link.expiresAt ? fmtDate(link.expiresAt) : 'No expiry';
  const body = `
<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
    <div class="brand" style="margin:0"><span class="dot"></span>${esc(BRAND)}</div>
    <a class="btn ghost sm" href="/admin">Back</a>
  </div>
  ${flash ? `<div class="flash ${flash.type === 'err' ? 'err' : 'ok'}">${esc(flash.msg)}</div>` : ''}
  <div class="card">
    <h1>Edit link</h1>
    <p class="muted">Current expiry: ${esc(currentExpiry)} · ${link.uploads.length} file(s) received so far.</p>
    <form method="post" action="/admin/links/${esc(link.id)}/edit">
      <label>Label</label>
      <input type="text" name="label" value="${esc(link.label || '')}" required>

      <div class="row">
        <div>
          <label>Expiry</label>
          <select name="expiresIn">
            <option value="keep" selected>Keep current (${esc(currentExpiry)})</option>
            <option value="none">No expiry</option>
            <option value="1">1 hour from now</option>
            <option value="24">24 hours from now</option>
            <option value="72">3 days from now</option>
            <option value="168">7 days from now</option>
            <option value="720">30 days from now</option>
          </select>
        </div>
        <div>
          <label>Max files <span class="muted">(blank = unlimited)</span></label>
          <input type="number" name="maxUses" min="1" value="${link.maxUses ? esc(link.maxUses) : ''}" placeholder="Unlimited">
        </div>
      </div>

      <label>Note to uploader <span class="muted">(optional)</span></label>
      <input type="text" name="note" value="${esc(link.note || '')}" placeholder="Shown on the upload page">

      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn" type="submit">Save changes</button>
        <a class="btn ghost" href="/admin">Cancel</a>
      </div>
    </form>
  </div>
</div>`;
  return layout({ title: 'Edit link', body });
}

function uploadPage({ link, status, baseUrl, maxUploadMb }) {
  if (!status.ok) {
    let msg = 'This upload link is no longer available.';
    if (status.reason === 'expired') msg = 'This upload link has expired.';
    else if (status.reason === 'revoked') msg = 'This upload link has been disabled.';
    else if (status.reason === 'maxed') msg = 'This upload link has reached its file limit.';
    else if (status.reason === 'notfound') msg = 'This upload link is invalid.';
    const body = `
<div class="wrap narrow">
  <div class="brand"><span class="dot"></span>${esc(BRAND)}</div>
  <div class="card">
    <h1>Link unavailable</h1>
    <p class="muted">${esc(msg)} Please ask your contact for a new link.</p>
  </div>
</div>`;
    return layout({ title: 'Link unavailable', body });
  }

  const body = `
<div class="wrap narrow">
  <div class="brand"><span class="dot"></span>${esc(BRAND)}</div>
  <div class="card">
    <h1>Upload files</h1>
    <p class="muted">${
      link.note
        ? esc(link.note)
        : 'Add your files below and click Upload. Your files are sent securely.'
    }</p>

    <label>Your name <span class="muted">(optional)</span></label>
    <input type="text" id="uploaderName" placeholder="So we know who sent it">

    <label>Files</label>
    <div id="drop" class="drop">
      <input type="file" id="files" multiple hidden>
      <div class="dropinner">
        <strong>Drag &amp; drop files here</strong>
        <div class="muted">or <a href="#" id="browse">browse to choose</a></div>
      </div>
    </div>
    <div id="list"></div>

    <button class="btn" id="go" style="margin-top:18px;width:100%" disabled>Upload</button>
    <div id="prog" class="progwrap" style="display:none"><div id="bar" class="progbar"></div></div>
    <div id="msg"></div>
  </div>
  <div class="foot">${maxUploadMb > 0 ? `Max ${maxUploadMb} MB per file · ` : ''}${esc(BRAND)}</div>
</div>`;

  const css = `
.drop{border:2px dashed var(--border);border-radius:10px;padding:28px;text-align:center;cursor:pointer;transition:.15s}
.drop.hover{border-color:var(--accent);background:#fff7ed}
.dropinner strong{display:block;margin-bottom:4px}
.filerow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.filerow:last-child{border-bottom:none}
.filerow .rm{color:var(--err);cursor:pointer;font-size:12px}
.progwrap{height:8px;background:#f3f4f6;border-radius:999px;margin-top:14px;overflow:hidden}
.progbar{height:100%;width:0;background:var(--accent);transition:width .2s}
#msg .flash{margin-top:14px}
`;

  const js = `
var maxBytes=${Number(maxUploadMb) * 1024 * 1024};
var token=${JSON.stringify(link.token)};
var picked=[];
var drop=document.getElementById('drop');
var input=document.getElementById('files');
var list=document.getElementById('list');
var go=document.getElementById('go');
var msg=document.getElementById('msg');

function fmt(n){var u=['B','KB','MB','GB'],i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toFixed(i?1:0)+' '+u[i];}
function render(){
  list.innerHTML='';
  picked.forEach(function(f,idx){
    var over=maxBytes>0&&f.size>maxBytes;
    var row=document.createElement('div');row.className='filerow';
    row.innerHTML='<span>'+f.name.replace(/[<>&]/g,'')+' <span class="muted">'+fmt(f.size)+(over?' — too large':'')+'</span></span>';
    var rm=document.createElement('span');rm.className='rm';rm.textContent='Remove';
    rm.onclick=function(){picked.splice(idx,1);render();};
    row.appendChild(rm);
    if(over)row.style.color='var(--err)';
    list.appendChild(row);
  });
  var anyOver=maxBytes>0&&picked.some(function(f){return f.size>maxBytes;});
  go.disabled=picked.length===0||anyOver;
}
function addFiles(fl){for(var i=0;i<fl.length;i++)picked.push(fl[i]);render();}
document.getElementById('browse').onclick=function(e){e.preventDefault();input.click();};
drop.onclick=function(){input.click();};
input.onchange=function(){addFiles(input.files);input.value='';};
['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('hover');});});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('hover');});});
drop.addEventListener('drop',function(e){addFiles(e.dataTransfer.files);});

go.onclick=function(){
  if(!picked.length)return;
  go.disabled=true;go.textContent='Uploading…';msg.innerHTML='';
  var fd=new FormData();
  fd.append('uploaderName',document.getElementById('uploaderName').value||'');
  picked.forEach(function(f){fd.append('files',f,f.name);});
  var xhr=new XMLHttpRequest();
  xhr.open('POST','/u/'+token,true);
  var pw=document.getElementById('prog');var bar=document.getElementById('bar');pw.style.display='block';
  xhr.upload.onprogress=function(e){if(e.lengthComputable){bar.style.width=(e.loaded/e.total*100).toFixed(0)+'%';}};
  xhr.onload=function(){
    if(xhr.status>=200&&xhr.status<300){
      msg.innerHTML='<div class="flash ok">Thank you — your files were uploaded successfully.</div>';
      picked=[];render();go.style.display='none';document.getElementById('drop').style.display='none';
    }else{
      var t='Upload failed. Please try again.';try{t=JSON.parse(xhr.responseText).error||t;}catch(e){}
      msg.innerHTML='<div class="flash err">'+t.replace(/[<>&]/g,'')+'</div>';
      go.disabled=false;go.textContent='Upload';pw.style.display='none';
    }
  };
  xhr.onerror=function(){msg.innerHTML='<div class="flash err">Network error. Please try again.</div>';go.disabled=false;go.textContent='Upload';pw.style.display='none';};
  xhr.send(fd);
};
render();
`;
  return layout({ title: 'Upload files', body, extraCss: css, extraJs: js });
}

function downloadPage({ send, status }) {
  if (!status.ok) {
    let msg = 'This download link is no longer available.';
    if (status.reason === 'expired') msg = 'This download link has expired.';
    else if (status.reason === 'revoked') msg = 'This download link has been disabled.';
    else if (status.reason === 'maxed') msg = 'This download link has reached its download limit.';
    else if (status.reason === 'notfound') msg = 'This download link is invalid.';
    const body = `
<div class="wrap narrow">
  <div class="brand"><span class="dot"></span>${esc(BRAND)}</div>
  <div class="card">
    <h1>Link unavailable</h1>
    <p class="muted">${esc(msg)} Please ask your contact for a new link.</p>
  </div>
</div>`;
    return layout({ title: 'Link unavailable', body });
  }

  const rows = send.files
    .map(
      (f) => `
    <div class="filerow">
      <span style="word-break:break-all">${esc(f.originalName)} <span class="muted">${fmtBytes(f.size)}</span></span>
      <a class="btn sm" href="/d/${esc(send.token)}/${encodeURIComponent(f.storedName)}">Download</a>
    </div>`
    )
    .join('');

  const body = `
<div class="wrap narrow">
  <div class="brand"><span class="dot"></span>${esc(BRAND)}</div>
  <div class="card">
    <h1>${esc(send.label || 'Shared files')}</h1>
    <p class="muted">${
      send.note
        ? esc(send.note)
        : 'The files below have been shared with you. Click Download to save them.'
    }</p>
    <div class="filelist">${rows}</div>
  </div>
  <div class="foot">${esc(BRAND)}</div>
</div>`;

  const css = `
.filelist{margin-top:10px}
.filerow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);font-size:14px}
.filerow:last-child{border-bottom:none}
`;
  return layout({ title: 'Download files', body, extraCss: css });
}

function docHeader(active) {
  const tab = (href, label) =>
    `<a class="btn ghost sm${active === label ? ' current' : ''}" href="${href}">${label}</a>`;
  return `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:24px">
    <div class="brand" style="margin:0"><span class="dot"></span>${esc(BRAND)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${tab('/admin', 'Admin')}
      ${tab('/admin/manual', 'Manual')}
      ${tab('/admin/architecture', 'Architecture')}
    </div>
  </div>`;
}

const DOC_CSS = `
.doc h1{margin-bottom:6px}
.doc h2{font-size:16px;margin:2px 0 12px}
.doc p{margin:0 0 12px}
.doc ol,.doc ul{margin:0 0 12px;padding-left:20px}
.doc li{margin:6px 0}
.doc .card{padding:22px 24px}
.callout{display:flex;gap:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:4px 0 6px;font-size:14px}
.callout .k{flex:0 0 auto;font-weight:700;color:var(--accent)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:#f3f4f6;padding:1px 6px;border-radius:5px}
.doc table{margin-top:6px}
.doc td .mono{background:none;padding:0}
.btn.current{background:var(--accent);color:#fff;border-color:var(--accent)}
/* architecture diagram */
.lane{margin:0 0 22px}
.lanelabel{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:10px}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.node{border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;background:#fff}
.node .t{font-weight:600}
.node .s{color:var(--muted);font-size:11px;margin-top:2px}
.node.accent{border-color:var(--accent);background:#fff7ed}
.arrow{color:var(--muted);font-weight:700;flex:0 0 auto}
`;

function manualPage() {
  const body = `
<div class="wrap doc">
  ${docHeader('Manual')}

  <div class="card">
    <h1>How ${esc(BRAND)} works</h1>
    <p class="muted">A secure way to move files with people who don't have an account. It works in <strong>both directions</strong> — collecting files from someone, and handing files to someone.</p>
    <div class="callout">
      <span class="k">Key idea</span>
      <span><span class="mono">/u/…</span> links are for people to <strong>upload files to you</strong>. <span class="mono">/d/…</span> links are for people to <strong>download files from you</strong>. A <span class="mono">/u/</span> link only ever shows a drop box — it never offers anything to download.</span>
    </div>
  </div>

  <div class="card">
    <h2>Receiving files — “upload links” (<span class="mono">/u/…</span>)</h2>
    <ol>
      <li>Under <strong>Create an upload link</strong>, add a label (e.g. “Tax docs from Jane”), optionally an expiry and/or a max-file limit (set max = 1 for one-time use), and an optional note the uploader will see.</li>
      <li><strong>Copy</strong> the link and send it to the person.</li>
      <li>They open it and drag in files — no account or password needed on their end.</li>
      <li>Their files appear under <strong>Received files</strong>, where you can <strong>Download</strong> or <strong>Delete</strong> them.</li>
      <li><strong>Disable</strong> a link anytime to kill it immediately; you can re-enable or delete it later.</li>
    </ol>
  </div>

  <div class="card">
    <h2>Sending files — “download links” (<span class="mono">/d/…</span>)</h2>
    <p>Two ways to create one:</p>
    <ul>
      <li><strong>Send a file</strong> (card on the Admin page): drag in one or more fresh files, optionally set an expiry / max-downloads / note, then <strong>Create download link</strong>. It gives you a <span class="mono">/d/…</span> link.</li>
      <li><strong>Share</strong> button on any <em>received</em> file: instantly turns a file someone sent you into a <span class="mono">/d/…</span> download link — no re-uploading. The original stays in Received files.</li>
    </ul>
    <p>Copy the new link from the <strong>Download links</strong> section and send it. The recipient opens it and clicks <strong>Download</strong> — no account needed. Manage links there too (disable / enable / delete).</p>
  </div>

  <div class="card">
    <h2>Link controls &amp; security</h2>
    <ul>
      <li><strong>Expiry</strong> — the link stops working after the chosen time.</li>
      <li><strong>Max files / max downloads</strong> — the link auto-closes after N uses (set to 1 for a strict one-time link).</li>
      <li><strong>Disable / Delete</strong> — kill a link on demand; deleting a download link also removes its shared files from the server.</li>
      <li>Links are <strong>unguessable random tokens</strong> — anyone holding the link can use it, so treat the link itself as the secret. Everything runs over HTTPS.</li>
      <li>The admin area (this page) is password-protected; the uploader/recipient never see it.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Good to know</h2>
    <ul>
      <li><strong>No size limit</strong> — upload and download files of any size (bounded only by free space on the server).</li>
      <li>Files stay on the server until you delete them (or a link is deleted). There's no automatic cleanup.</li>
      <li>If a recipient says “there's nothing to download,” you almost certainly sent a <span class="mono">/u/</span> (upload) link — send them a <span class="mono">/d/</span> link instead.</li>
    </ul>
  </div>
</div>`;
  return layout({ title: 'Manual', body, extraCss: DOC_CSS });
}

function node(cls, title, sub) {
  return `<div class="node ${cls}"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
}
const ARROW = '<span class="arrow">→</span>';

function architecturePage() {
  const inbound = [
    node('', 'Outsider', 'no account'),
    node('accent', '/u/&lt;token&gt;', 'upload page'),
    node('', 'nginx + TLS', 'body size: unlimited'),
    node('', 'Node / Express', 'multer streams to disk'),
    node('', 'data/uploads/&lt;token&gt;/', 'received files'),
    node('', 'Admin', 'browse / download'),
  ].join(ARROW);
  const outbound = [
    node('', 'Admin', 'uploads, or clicks Share'),
    node('', 'Node / Express', 'multer, or hardlink'),
    node('', 'data/sends/&lt;token&gt;/', 'hardlink — no extra disk'),
    node('accent', '/d/&lt;token&gt;', 'download page'),
    node('', 'Recipient', 'no account'),
  ].join(ARROW);

  const body = `
<div class="wrap doc">
  ${docHeader('Architecture')}

  <div class="card">
    <h1>Architecture</h1>
    <p class="muted">A single small Node/Express app behind nginx. No database, no cloud services — files are plain files on the server's disk, and all metadata sits in one JSON file.</p>
    <p><strong>Stack:</strong> Node + Express · <span class="mono">cookie-session</span> (admin auth) · <span class="mono">multer</span> (uploads) · a tiny JSON-file datastore · nginx + certbot (TLS) · systemd service on <span class="mono">axus-server01</span>, app on <span class="mono">127.0.0.1:3210</span>.</p>
  </div>

  <div class="card">
    <h2>How data flows</h2>
    <div class="lane">
      <div class="lanelabel">Inbound — someone sends files to you</div>
      <div class="flow">${inbound}</div>
    </div>
    <div class="lane">
      <div class="lanelabel">Outbound — you share files with someone</div>
      <div class="flow">${outbound}</div>
    </div>
    <p class="muted" style="margin-top:8px">The <strong>Share</strong> button hardlinks a received file into a download link: instant, and it uses no extra disk because <span class="mono">uploads/</span> and <span class="mono">sends/</span> live on the same filesystem. Deleting the received file or the share link leaves the other intact.</p>
  </div>

  <div class="card">
    <h2>Where things live on the server</h2>
    <table>
      <thead><tr><th>Path</th><th>Contents</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">/opt/axus-fileshare</span></td><td>application code</td></tr>
        <tr><td><span class="mono">data/db.json</span></td><td>all metadata — <span class="mono">links</span> (inbound) + <span class="mono">sends</span> (outbound). Held in memory, rewritten on every change.</td></tr>
        <tr><td><span class="mono">data/uploads/&lt;token&gt;/</span></td><td>files people uploaded to you</td></tr>
        <tr><td><span class="mono">data/sends/&lt;token&gt;/</span></td><td>files you share out (hardlinks to received files, or freshly uploaded ones)</td></tr>
        <tr><td><span class="mono">.env</span></td><td>admin credentials + config (not in git)</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Key routes</h2>
    <table>
      <thead><tr><th>Route</th><th>Who</th><th>Purpose</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">GET /u/:token</span></td><td>public</td><td>upload page (drop box)</td></tr>
        <tr><td><span class="mono">POST /u/:token</span></td><td>public</td><td>receive uploaded files</td></tr>
        <tr><td><span class="mono">GET /d/:token</span></td><td>public</td><td>download page (file list)</td></tr>
        <tr><td><span class="mono">GET /d/:token/:file</span></td><td>public</td><td>download a shared file</td></tr>
        <tr><td><span class="mono">/admin, /admin/links, /admin/sends, /admin/files/…</span></td><td>admin</td><td>dashboard, link + file management</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Operations</h2>
    <ul>
      <li><strong>Deploy:</strong> <span class="mono">bash deploy/deploy.sh</span> — syncs code (not data/.env), installs deps, restarts the service.</li>
      <li><strong>Restart:</strong> <span class="mono">sudo systemctl restart axus-fileshare</span> (also reloads <span class="mono">db.json</span> into memory).</li>
      <li><strong>Logs:</strong> <span class="mono">journalctl -u axus-fileshare</span>. <strong>TLS + routing:</strong> nginx site for <span class="mono">${esc(BRAND)}</span>.</li>
    </ul>
  </div>
</div>`;
  return layout({ title: 'Architecture', body, extraCss: DOC_CSS });
}

module.exports = {
  loginPage,
  adminPage,
  editPage,
  uploadPage,
  downloadPage,
  manualPage,
  architecturePage,
  esc,
  fmtBytes,
  BRAND,
};

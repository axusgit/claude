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
    ${
      link.revoked
        ? ''
        : `<form method="post" action="/admin/links/${esc(link.id)}/revoke" style="display:inline" onsubmit="return confirm('Disable this link? Uploaders will no longer be able to use it.')">
             <button class="btn sm danger" type="submit">Disable</button>
           </form>`
    }
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
    <form method="post" action="/admin/files/${esc(link.token)}/${encodeURIComponent(up.storedName)}/delete" style="display:inline" onsubmit="return confirm('Delete this file permanently?')">
      <button class="btn sm danger" type="submit">Delete</button>
    </form>
  </td>
</tr>`
    )
    .join('');
}

function adminPage({ links, baseUrl, statusOf, flash, maxUploadMb }) {
  const activeCount = links.filter((l) => statusOf(l).ok).length;
  const fileCount = links.reduce((n, l) => n + l.uploads.length, 0);
  const body = `
<div class="wrap">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
    <div class="brand" style="margin:0"><span class="dot"></span>${esc(BRAND)}</div>
    <a class="btn ghost sm" href="/admin/logout">Sign out</a>
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

  <div class="foot">Max upload size: ${maxUploadMb} MB per file · ${esc(BRAND)}</div>
</div>`;

  const js = `
function copyLink(id,btn){
  var el=document.getElementById(id);
  el.select();
  navigator.clipboard.writeText(el.value).then(function(){
    var t=btn.textContent;btn.textContent='Copied';
    setTimeout(function(){btn.textContent=t},1500);
  }).catch(function(){document.execCommand('copy');});
}`;
  return layout({ title: 'Admin', body, extraJs: js });
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
  <div class="foot">Max ${maxUploadMb} MB per file · ${esc(BRAND)}</div>
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
    var over=f.size>maxBytes;
    var row=document.createElement('div');row.className='filerow';
    row.innerHTML='<span>'+f.name.replace(/[<>&]/g,'')+' <span class="muted">'+fmt(f.size)+(over?' — too large':'')+'</span></span>';
    var rm=document.createElement('span');rm.className='rm';rm.textContent='Remove';
    rm.onclick=function(){picked.splice(idx,1);render();};
    row.appendChild(rm);
    if(over)row.style.color='var(--err)';
    list.appendChild(row);
  });
  var anyOver=picked.some(function(f){return f.size>maxBytes;});
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

module.exports = { loginPage, adminPage, uploadPage, esc, fmtBytes, BRAND };

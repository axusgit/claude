"use strict";

// Live VoIP collector dashboard. Two SSE feeds drive everything:
//   /api/stream                  -> the test list (near real-time)
//   /api/tests/{code}/stream     -> the selected test's detail + history
// Charts are drawn on plain <canvas> so the server stays a single binary with
// no external JS dependencies.

const $ = (sel) => document.querySelector(sel);
const conn = $("#conn");

let selected = null;      // currently open CODE
let detailSrc = null;     // EventSource for the detail feed
const compareSet = new Set(); // CODEs ticked for comparison

// ---- Test list --------------------------------------------------------------

function openListStream() {
  const src = new EventSource("/api/stream");
  src.onopen = () => { conn.textContent = "live"; conn.className = "conn live"; };
  src.onerror = () => { conn.textContent = "reconnecting…"; conn.className = "conn down"; };
  src.onmessage = (e) => renderList(JSON.parse(e.data).tests || []);
}

function renderList(tests) {
  const body = $("#tests-body");
  $("#test-count").textContent = tests.length ? `${tests.length} total` : "";
  if (!tests.length) {
    body.innerHTML = `<tr><td colspan="13" class="empty">No tests yet. Create one via the control API.</td></tr>`;
    return;
  }
  // Drop selections for tests that no longer exist.
  const codes = new Set(tests.map((t) => t.code));
  for (const c of [...compareSet]) if (!codes.has(c)) compareSet.delete(c);

  body.innerHTML = "";
  for (const t of tests) {
    const tr = document.createElement("tr");
    if (t.code === selected) tr.className = "active";
    const pickable = hasStats(t);
    const checked = compareSet.has(t.code) ? "checked" : "";
    tr.innerHTML = `
      <td class="pick">${pickable ? `<input type="checkbox" class="cmp" ${checked} aria-label="compare ${t.code}">` : ""}</td>
      <td class="code">${t.code}</td>
      <td><span class="state ${t.state}">${t.state}</span></td>
      <td>${codecName(t.codec)}</td>
      <td>${t.transport.toUpperCase()}</td>
      <td class="num">${t.channels}</td>
      <td class="num">${t.ptime_ms}ms</td>
      <td>${t.client_ip ? `${escapeHtml(t.client_id || "?")} <span class="muted">${t.client_ip}</span>` : "<span class='muted'>—</span>"}</td>
      <td class="num">${fmt(t.elapsed_sec, 0)}s</td>
      <td class="num">${t.state === "running" ? fmt(t.remain_sec, 0) + "s" : "—"}</td>
      <td class="num">${hasStats(t) ? fmt(t.loss_pct, 2) : "—"}</td>
      <td class="num">${hasStats(t) ? fmt(t.mos, 2) : "—"}</td>
      <td>${verdictCell(t)}</td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.classList.contains("cmp")) return; // let the checkbox handle it
      openDetail(t.code);
    });
    const cb = tr.querySelector(".cmp");
    if (cb) cb.addEventListener("change", () => {
      if (cb.checked) compareSet.add(t.code); else compareSet.delete(t.code);
      updateCompareBtn();
    });
    body.appendChild(tr);
  }
  updateCompareBtn();
}

function updateCompareBtn() {
  const btn = $("#compare-btn");
  btn.textContent = `Compare (${compareSet.size})`;
  btn.disabled = compareSet.size < 2;
}

function hasStats(t) { return t.state === "running" || t.state === "complete"; }

function verdictCell(t) {
  if (!hasStats(t)) return "<span class='muted'>—</span>";
  return t.pass ? "<span class='verdict-pass'>PASS</span>" : "<span class='verdict-fail'>FAIL</span>";
}

// ---- Test detail ------------------------------------------------------------

function openDetail(code) {
  selected = code;
  if (detailSrc) detailSrc.close();
  $("#detail").hidden = false;
  $("#d-code").textContent = code;
  $("#r-txt").href = `/api/tests/${code}/report?format=txt`;
  $("#r-json").href = `/api/tests/${code}/report?format=json`;
  $("#r-csv").href = `/api/tests/${code}/report?format=csv`;
  document.querySelectorAll("#tests-body tr").forEach((tr) =>
    tr.classList.toggle("active", tr.firstElementChild?.textContent === code));

  detailSrc = new EventSource(`/api/tests/${code}/stream`);
  detailSrc.onmessage = (e) => renderDetail(JSON.parse(e.data));
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#d-close").addEventListener("click", () => {
  if (detailSrc) { detailSrc.close(); detailSrc = null; }
  selected = null;
  $("#detail").hidden = true;
  document.querySelectorAll("#tests-body tr").forEach((tr) => tr.classList.remove("active"));
});

// ---- Compare ----------------------------------------------------------------

$("#compare-btn").addEventListener("click", openCompare);
$("#compare-close").addEventListener("click", () => { $("#compare").hidden = true; });

async function openCompare() {
  const codes = [...compareSet];
  if (codes.length < 2) return;
  const results = [];
  for (const code of codes) {
    try {
      const r = await fetch(`/api/tests/${code}/report?format=json`);
      if (r.ok) results.push(await r.json());
    } catch (e) { /* skip unreachable */ }
  }
  if (results.length < 2) return;
  renderCompare(results);
  $("#compare").hidden = false;
  $("#compare").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCompare(results) {
  const col = (r) => {
    const c = r.config || {}, a = r.aggregate || {}, f = r.forward_agg || {}, rt = r.return_agg || {};
    return {
      code: r.code,
      cells: {
        "Codec": codecName(c.codec) + (c.codec === "opus" ? ` ${c.bitrate_kbps || 32}k` : ""),
        "Transport": (c.transport || "").toUpperCase(),
        "Channels": c.channels,
        "Ptime": (c.ptime_ms || "") + "ms",
        "Duration": (c.duration_sec || "") + "s",
        "DSCP": c.dscp || 0,
        "Verdict": a.pass ? "PASS" : "FAIL",
        "Loss % (round-trip)": fmt(a.loss_pct, 3),
        "MOS mean": fmt(a.mos_mean, 2),
        "MOS worst": fmt(a.mos_min, 2),
        "Jitter mean (ms)": fmt(a.jitter_mean_ms, 2),
        "RTT mean (ms)": fmt(a.rtt_mean_ms, 2),
        "One-way (ms)": fmt(a.oneway_ms, 2),
        "Fwd loss %": fmt(f.loss_pct, 3),
        "Ret loss %": fmt(rt.loss_pct, 3),
        "Bitrate (kbps)": fmt(a.bitrate_kbps, 0),
      },
    };
  };
  const cols = results.map(col);
  const keys = Object.keys(cols[0].cells);
  let html = `<tr><th>Metric</th>${cols.map((c) => `<th class="code">${c.code}</th>`).join("")}</tr>`;
  for (const key of keys) {
    html += `<tr><td class="muted">${key}</td>${cols.map((c) => {
      const v = c.cells[key];
      const cls = key === "Verdict" ? (v === "PASS" ? "verdict-pass" : "verdict-fail") : "num";
      return `<td class="${cls}">${v}</td>`;
    }).join("")}</tr>`;
  }
  $("#compare-body").innerHTML = html;
}

function renderDetail(d) {
  const c = d.config || {};
  const profs = (c.profiles || []).map((p) => {
    const r = p.codec === "opus" ? ` ${p.bitrate_kbps || 32}k` : "";
    return `${codecName(p.codec)}${r}×${p.channels}@${p.ptime_ms}ms`;
  }).join(" + ");
  const dscp = c.dscp ? ` · DSCP ${c.dscp}${c.dscp === 46 ? " (EF)" : ""}` : "";
  $("#d-config").textContent =
    `${profs} · ${(c.transport||"").toUpperCase()} · ${c.duration_sec}s${dscp} · state ${d.state}`;
  $("#d-tcpnote").hidden = c.transport !== "tcp";

  const v = $("#d-verdict");
  const running = d.state === "running" || d.state === "complete";
  const a = d.aggregate || {};
  if (running) {
    v.textContent = a.pass ? "PASS" : "FAIL";
    v.className = "badge " + (a.pass ? "pass" : "fail");
  } else {
    v.textContent = d.state;
    v.className = "badge";
  }

  renderCards(d, a);
  renderDirections(d.forward_agg || {}, d.return_agg || {});
  renderChannels(d.channels || []);
  drawCharts(d.history || [], c);
}

// One-way (forward / return) summary cards.
function renderDirections(f, r) {
  const el = $("#d-dir");
  const measured = (f.recv || 0) + (f.lost || 0) > 0;
  document.querySelector(".dir-head").hidden = !measured;
  if (!measured) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = [
    kpi("Fwd loss", fmt(f.loss_pct, 3) + "%", (f.loss_pct || 0) > 0),
    kpi("Fwd jitter", fmt(f.jitter_mean_ms, 2) + " ms"),
    kpi("Fwd recv/lost", `${f.recv || 0} / ${f.lost || 0}`),
    kpi("Ret loss", fmt(r.loss_pct, 3) + "%", (r.loss_pct || 0) > 0),
    kpi("Ret recv/lost", `${r.recv || 0} / ${r.lost || 0}`),
  ].join("");
}

function renderCards(d, a) {
  const th = (d.config || {}).thresholds || {};
  const cards = [
    kpi("Loss", fmt(a.loss_pct, 3) + "%", a.loss_pct >= th.loss_pct),
    kpi("Mean jitter", fmt(a.jitter_mean_ms, 2) + " ms", a.jitter_mean_ms >= th.jitter_ms),
    kpi("Peak jitter", fmt(a.jitter_max_ms, 2) + " ms"),
    kpi("RTT mean", fmt(a.rtt_mean_ms, 2) + " ms"),
    kpi("One-way*", fmt(a.oneway_ms, 2) + " ms", a.oneway_ms >= th.oneway_ms),
    kpi("MOS mean", fmt(a.mos_mean, 2), a.mos_mean < th.mos, true),
    kpi("MOS worst", fmt(a.mos_min, 2) + ` (ch ${a.worst_channel})`, a.mos_min < th.mos, true),
    kpi("R-factor", fmt(a.r_factor_mean, 1)),
    kpi("Throughput", fmt(a.bitrate_kbps, 0) + " / " + fmt(a.expected_kbps, 0), false, false, " kbps"),
    kpi("Bursts / longest", `${a.burst_count || 0} / ${a.longest_burst || 0}`),
    kpi("Reord / dup", `${a.reordered || 0} / ${a.duplicates || 0}`),
    kpi("Packets", `${a.packets_recv || 0} / ${a.packets_sent || 0}`),
  ];
  $("#d-cards").innerHTML = cards.join("");
}

function kpi(k, val, bad, lowerIsWorse, suffix) {
  let cls = "card";
  if (bad === true) cls += " bad";
  const s = suffix ? `<small>${suffix}</small>` : "";
  return `<div class="${cls}"><div class="k">${k}</div><div class="v">${val}${s}</div></div>`;
}

function renderChannels(chans) {
  const sorted = [...chans].sort((a, b) => a.mos - b.mos); // worst first
  const body = $("#channels-body");
  body.innerHTML = "";
  for (const c of sorted) {
    const tr = document.createElement("tr");
    if (!c.pass) tr.className = "chan-fail";
    tr.innerHTML = `
      <td class="num">${c.channel}</td>
      <td>${c.pass ? "<span class='verdict-pass'>PASS</span>" : "<span class='verdict-fail'>FAIL</span>"}</td>
      <td class="num">${fmt(c.loss_pct, 3)}</td>
      <td class="num">${c.burst_count}/${c.longest_burst}</td>
      <td class="num">${fmt(c.jitter_ms, 2)}</td>
      <td class="num">${fmt(c.jitter_p95_ms, 2)}</td>
      <td class="num">${fmt(c.rtt_mean_ms, 2)}</td>
      <td class="num">${fmt(c.oneway_ms, 2)}</td>
      <td class="num">${fmt(c.bitrate_kbps, 0)}</td>
      <td class="num">${fmt(c.r_factor, 1)}</td>
      <td class="num">${fmt(c.mos, 2)}</td>`;
    body.appendChild(tr);
  }
}

// ---- Create test ------------------------------------------------------------

let probeDownload = false;
fetch("/api/config").then((r) => r.json()).then((c) => { probeDownload = !!c.probe_download; }).catch(() => {});

const CODECS = [["g711", "G.711"], ["g729", "G.729"], ["g722", "G.722"], ["opus", "Opus"]];

$("#new-test-btn").addEventListener("click", () => {
  const panel = $("#create");
  panel.hidden = false;
  if (!$("#profiles-body").children.length) addProfileRow();
  $("#create-result").hidden = true;
  $("#create-error").textContent = "";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#create-close").addEventListener("click", () => { $("#create").hidden = true; });
$("#add-profile").addEventListener("click", () => addProfileRow());
$("#create-submit").addEventListener("click", submitCreate);

function addProfileRow(preset) {
  const tr = document.createElement("tr");
  const codecOpts = CODECS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
  tr.innerHTML = `
    <td><select class="p-codec">${codecOpts}</select></td>
    <td class="num"><input class="p-chans" type="number" min="1" max="5000" value="${preset?.channels || 10}"></td>
    <td>
      <select class="p-ptime">
        <option value="10">10 ms</option><option value="20" selected>20 ms</option><option value="30">30 ms</option>
      </select>
    </td>
    <td><input class="p-bitrate" type="number" min="6" max="510" value="32" disabled title="Opus only"></td>
    <td><button class="row-del" title="remove">✕</button></td>`;
  const codecSel = tr.querySelector(".p-codec");
  const bitrate = tr.querySelector(".p-bitrate");
  codecSel.addEventListener("change", () => { bitrate.disabled = codecSel.value !== "opus"; });
  tr.querySelector(".row-del").addEventListener("click", () => {
    tr.remove();
    if (!$("#profiles-body").children.length) addProfileRow();
  });
  if (preset?.codec) codecSel.value = preset.codec;
  $("#profiles-body").appendChild(tr);
}

function submitCreate() {
  const err = $("#create-error");
  err.textContent = "";
  const profiles = [...$("#profiles-body").children].map((tr) => {
    const codec = tr.querySelector(".p-codec").value;
    const p = {
      codec,
      channels: parseInt(tr.querySelector(".p-chans").value, 10) || 0,
      ptime_ms: parseInt(tr.querySelector(".p-ptime").value, 10),
    };
    if (codec === "opus") p.bitrate_kbps = parseInt(tr.querySelector(".p-bitrate").value, 10) || 32;
    return p;
  });
  if (profiles.some((p) => p.channels < 1)) { err.textContent = "Every profile needs at least 1 channel."; return; }

  const body = {
    transport: $("#f-transport").value,
    duration_sec: parseInt($("#f-duration").value, 10) || 30,
    dscp: parseInt($("#f-dscp").value, 10) || 0,
    thresholds: {
      loss_pct: parseFloat($("#t-loss").value) || 1,
      jitter_ms: parseFloat($("#t-jitter").value) || 30,
      oneway_ms: parseFloat($("#t-oneway").value) || 150,
      mos: parseFloat($("#t-mos").value) || 4,
    },
    profiles,
  };

  const btn = $("#create-submit");
  btn.disabled = true;
  fetch("/api/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `server returned ${r.status}`);
      return data;
    })
    .then((data) => showCreateResult(data.code))
    .catch((e) => { err.textContent = e.message; })
    .finally(() => { btn.disabled = false; });
}

function showCreateResult(code) {
  const origin = window.location.origin;
  const dl = probeDownload
    ? `<p><a href="/download/probe.exe" download>⬇ Download probe.exe</a> — give this and the CODE to whoever runs the test.</p>`
    : `<p class="muted">Give the technician <code>probe.exe</code> and the CODE below.</p>`;
  const simple = probeDownload ? `probe.exe -code ${code}` : `probe.exe -server ${origin} -code ${code}`;
  const box = $("#create-result");
  box.hidden = false;
  box.innerHTML = `
    <div>Test created — CODE <span class="code">${code}</span></div>
    ${dl}
    <p>On a computer inside the network under test, run:</p>
    <pre>${simple}</pre>
    <button class="btn-copy" data-copy="${simple}">copy command</button>
    ${probeDownload ? `<p class="muted" style="margin-top:10px">Or double-click the downloaded <code>probe.exe</code> and paste the CODE when prompted.</p>` : ""}
    <p class="muted" style="margin-top:10px">Explicit form (any probe build): <code>probe.exe -server ${origin} -code ${code}</code></p>`;
  box.querySelector(".btn-copy").addEventListener("click", (e) => {
    navigator.clipboard?.writeText(e.target.dataset.copy);
    e.target.textContent = "copied ✓";
  });
}

// ---- Canvas charts ----------------------------------------------------------

function drawCharts(history, cfg) {
  const t = history.map((p) => p.t);
  drawChart($("#chart-loss"), t, history.map((p) => p.loss), { color: "#f85149", min: 0 });
  drawChart($("#chart-jitter"), t, history.map((p) => p.jitter), { color: "#d29922", min: 0 });
  drawChart($("#chart-mos"), t, history.map((p) => p.mos), { color: "#2ea043", min: 1, max: 4.5 });
}

function drawChart(canvas, xs, ys, opts) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  let min = opts.min != null ? opts.min : Math.min(...ys, 0);
  let max = opts.max != null ? opts.max : Math.max(...ys, 0.001);
  if (ys.length) {
    if (opts.max == null) max = Math.max(max, ...ys);
    if (opts.min == null) min = Math.min(min, ...ys);
  }
  if (max <= min) max = min + 1;

  // grid + y labels
  ctx.strokeStyle = "#2a323d";
  ctx.fillStyle = "#8b98a9";
  ctx.font = "10px system-ui";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + (plotH * i) / 3;
    const val = max - ((max - min) * i) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(val.toFixed(val < 10 ? 1 : 0), 2, y + 3);
  }
  if (!xs.length) return;

  const xmax = Math.max(xs[xs.length - 1], 1);
  const X = (x) => pad.l + (plotW * x) / xmax;
  const Y = (y) => pad.t + plotH * (1 - (y - min) / (max - min));

  // area fill
  ctx.beginPath();
  ctx.moveTo(X(xs[0]), Y(ys[0]));
  for (let i = 1; i < xs.length; i++) ctx.lineTo(X(xs[i]), Y(ys[i]));
  ctx.lineTo(X(xs[xs.length - 1]), pad.t + plotH);
  ctx.lineTo(X(xs[0]), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = opts.color + "22";
  ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(X(xs[0]), Y(ys[0]));
  for (let i = 1; i < xs.length; i++) ctx.lineTo(X(xs[i]), Y(ys[i]));
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// ---- helpers ----------------------------------------------------------------

function fmt(v, d) {
  if (v == null || isNaN(v)) return "0";
  return Number(v).toFixed(d);
}
function codecName(c) {
  return { g711: "G.711", g729: "G.729", g722: "G.722", opus: "Opus" }[c] || c || "?";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// Show the signed-in user + logout (when reached through SSO).
fetch("/api/whoami").then((r) => r.json()).then((u) => {
  const name = u.name || u.user || u.email;
  if (name) {
    $("#user-name").textContent = name;
    $("#user").hidden = false;
  }
}).catch(() => {});

openListStream();

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
    body.innerHTML = `<tr><td colspan="12" class="empty">No tests yet. Create one via the control API.</td></tr>`;
    return;
  }
  body.innerHTML = "";
  for (const t of tests) {
    const tr = document.createElement("tr");
    if (t.code === selected) tr.className = "active";
    tr.innerHTML = `
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
    tr.addEventListener("click", () => openDetail(t.code));
    body.appendChild(tr);
  }
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

function renderDetail(d) {
  const c = d.config || {};
  $("#d-config").textContent =
    `${codecName(c.codec)} · ${(c.transport||"").toUpperCase()} · ${c.channels} ch · ${c.ptime_ms}ms · ${c.duration_sec}s · state ${d.state}`;
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
  renderChannels(d.channels || []);
  drawCharts(d.history || [], c);
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
function codecName(c) { return c === "g729" ? "G.729" : c === "g711" ? "G.711" : (c || "?"); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

openListStream();

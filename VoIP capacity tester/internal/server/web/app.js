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
    body.innerHTML = `<tr><td colspan="16" class="empty">No tests yet. Create one via the control API.</td></tr>`;
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
      <td class="nowrap">${fmtDate(t.created_at)}</td>
      <td><span class="state ${t.state}">${t.state}</span></td>
      <td>${codecsLabel(t)}</td>
      <td>${t.transport.toUpperCase()}</td>
      <td class="num">${t.channels}</td>
      <td class="num">${t.ptime_ms}ms</td>
      <td>${t.client_id ? escapeHtml(t.client_id) : "<span class='muted'>—</span>"}</td>
      <td>${t.client_ip ? `<span class="mono">${escapeHtml(t.client_ip)}</span>` : "<span class='muted'>—</span>"}</td>
      <td class="num">${fmt(t.elapsed_sec, 0)}s</td>
      <td class="num">${t.state === "running" ? fmt(t.remain_sec, 0) + "s" : "—"}</td>
      <td class="num">${hasStats(t) ? fmt(t.loss_pct, 2) : "—"}</td>
      <td class="num">${hasStats(t) ? fmt(t.mos, 2) : "—"}</td>
      <td>${verdictCell(t)}</td>
      <td class="del"><button class="del-btn" title="Delete test ${t.code}" aria-label="delete ${t.code}">✕</button></td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.classList.contains("cmp")) return;     // let the checkbox handle it
      if (e.target.classList.contains("del-btn")) return; // let the delete button handle it
      openDetail(t.code);
    });
    const cb = tr.querySelector(".cmp");
    if (cb) cb.addEventListener("change", () => {
      if (cb.checked) compareSet.add(t.code); else compareSet.delete(t.code);
      updateCompareBtn();
    });
    tr.querySelector(".del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTest(t.code);
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

function closeDetail() {
  if (detailSrc) { detailSrc.close(); detailSrc = null; }
  selected = null;
  $("#detail").hidden = true;
  $("#mos-gauge").hidden = true;
  document.querySelectorAll("#tests-body tr").forEach((tr) => tr.classList.remove("active"));
}
$("#d-close").addEventListener("click", closeDetail);

// Delete a test (any state): removes its record + report from the collector. The
// list SSE re-renders without the row once the server confirms.
function deleteTest(code) {
  if (!confirm(`Delete test ${code}?\n\nThis permanently removes its record and saved report from the collector. This cannot be undone.`)) return;
  fetch(`/api/admin/tests/${encodeURIComponent(code)}`, { method: "DELETE" })
    .then((r) => {
      if (!r.ok && r.status !== 204) throw new Error(`server returned ${r.status}`);
      compareSet.delete(code);
      updateCompareBtn();
      if (selected === code) closeDetail();
    })
    .catch((e) => alert(`Could not delete ${code}: ${e.message}`));
}

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
        "Duration": fmtDuration(c.duration_sec),
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
    `${profs} · ${(c.transport||"").toUpperCase()} · ${fmtDuration(c.duration_sec)}${dscp} · state ${d.state}`;
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
  renderBwGauge(a, running);
  updateMosGauge(a);
  renderDirections(d.forward_agg || {}, d.return_agg || {});
  renderChannels(d.channels || [], (d.config && d.config.profiles) || []);
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

// updateMosGauge positions the fixed center-right MOS gauge's marker at the
// test's mean MOS (and a dashed tick at the worst channel). Value 1..5 maps
// bottom (Bad) -> top (Excellent).
function updateMosGauge(a) {
  const g = $("#mos-gauge");
  g.hidden = false; // reference bands always visible while a test is open
  positionMosGauge();
  const marker = $("#mg-marker"), val = $("#mg-val"), worst = $("#mg-worst");
  const mos = a && a.mos_mean;
  const posPct = (m) => Math.max(0, Math.min(100, ((m - 1) / 4) * 100));
  if (!mos || mos <= 0) { marker.hidden = true; worst.hidden = true; return; }
  marker.style.bottom = posPct(mos) + "%";
  val.textContent = mos.toFixed(2);
  marker.hidden = false;
  const w = a.mos_min;
  if (w && w > 0 && Math.abs(w - mos) > 0.02) {
    worst.style.bottom = posPct(w) + "%";
    worst.hidden = false;
  } else {
    worst.hidden = true;
  }
}

// ---- Bandwidth needle gauge (total send+receive Mbps in use) ----------------

// niceMax rounds up to a "nice" axis maximum (1/2/2.5/5 × 10^n).
function niceMax(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}
function trimNum(v) { return (Math.round(v * 100) / 100).toString(); }

function renderBwGauge(a, running) {
  const el = $("#bw-gauge");
  if (!running) { el.hidden = true; el.innerHTML = ""; return; }
  const send = (a.expected_kbps || 0) / 1000;   // upstream (sent, nominal IP-layer)
  const recv = (a.bitrate_kbps || 0) / 1000;    // downstream (echoes actually received)
  const total = send + recv;
  // Full scale ≈ both directions at full load (2×send), with a little headroom.
  const max = niceMax(Math.max(send * 2, total) * 1.05) || 1;
  el.hidden = false;
  el.innerHTML = `<div class="bwg-title">Bandwidth in use <span class="muted">(send + receive)</span></div>` +
    bwGaugeSVG(total, max, send, recv);
}

// bwGaugeSVG draws a semicircular needle gauge (0..max Mbps) with the needle at
// `total`, the used portion filled, and a send/receive breakdown below.
function bwGaugeSVG(total, max, send, recv) {
  const cx = 130, cy = 124, r = 98;
  const f = Math.max(0, Math.min(1, max > 0 ? total / max : 0));
  const pt = (frac, rr) => {
    const th = Math.PI * (1 - frac);
    return [cx + rr * Math.cos(th), cy - rr * Math.sin(th)];
  };
  const arc = (f0, f1, rr) => {
    const [x0, y0] = pt(f0, rr), [x1, y1] = pt(f1, rr);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const fs = Math.max(0, Math.min(1, max > 0 ? send / max : 0)); // send portion
  const [nx, ny] = pt(f, 84);
  const [l0x, l0y] = pt(0, r), [lmx, lmy] = pt(0.5, r), [l1x, l1y] = pt(1, r);
  return `<svg viewBox="0 0 260 150" class="bwg-svg" role="img" aria-label="Bandwidth ${trimNum(total)} of ${trimNum(max)} Mbps">
    <path d="${arc(0, 1, r)}" class="bwg-track"/>
    <path d="${arc(0, fs, r)}" class="bwg-fill send"/>
    <path d="${arc(fs, f, r)}" class="bwg-fill recv"/>
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="bwg-needle"/>
    <circle cx="${cx}" cy="${cy}" r="6" class="bwg-hub"/>
    <text x="${cx}" y="${cy - 26}" class="bwg-val" text-anchor="middle">${trimNum(total)}</text>
    <text x="${cx}" y="${cy - 9}" class="bwg-unit" text-anchor="middle">Mbps total</text>
    <text x="${(l0x - 4).toFixed(0)}" y="${(l0y + 15).toFixed(0)}" class="bwg-tick" text-anchor="middle">0</text>
    <text x="${lmx.toFixed(0)}" y="${(lmy - 7).toFixed(0)}" class="bwg-tick" text-anchor="middle">${trimNum(max / 2)}</text>
    <text x="${(l1x + 4).toFixed(0)}" y="${(l1y + 15).toFixed(0)}" class="bwg-tick" text-anchor="middle">${trimNum(max)}</text>
  </svg>
  <div class="bwg-legend">
    <span><i class="bwg-dot send"></i>Send ${trimNum(send)}</span>
    <span><i class="bwg-dot recv"></i>Recv ${trimNum(recv)}</span>
    <span class="muted">Mbps</span>
  </div>`;
}

// positionMosGauge centers the fixed gauge horizontally in the gap between the
// content's right edge and the screen's right edge — so the table/detail stays
// centered and the gauge floats in the right margin. Falls back to the right edge
// if there isn't enough room (e.g. a narrower window).
function positionMosGauge() {
  const g = $("#mos-gauge");
  if (!g || g.hidden) return;
  const panel = $("#detail");
  const el = panel && !panel.hidden ? panel : document.querySelector("main");
  const contentRight = el.getBoundingClientRect().right;
  const gw = g.offsetWidth || 138;
  const gap = window.innerWidth - contentRight;
  const left = gap >= gw + 16 ? contentRight + (gap - gw) / 2 : window.innerWidth - gw - 8;
  g.style.left = Math.round(left) + "px";
  g.style.right = "auto";
}
window.addEventListener("resize", positionMosGauge);

function kpi(k, val, bad, lowerIsWorse, suffix) {
  let cls = "card";
  if (bad === true) cls += " bad";
  const s = suffix ? `<small>${suffix}</small>` : "";
  return `<div class="${cls}"><div class="k">${k}</div><div class="v">${val}${s}</div></div>`;
}

function renderChannels(chans, profiles) {
  profiles = profiles || [];
  const sorted = [...chans].sort((a, b) => a.channel - b.channel); // channel order
  // Zero-pad the channel number (00, 01, …) so the column aligns; width grows
  // with the channel count (2 digits min, 3+ for 100+ channels).
  const width = Math.max(2, String(Math.max(0, ...chans.map((c) => c.channel || 0))).length);
  const padCh = (n) => String(n).padStart(width, "0");
  const body = $("#channels-body");
  body.innerHTML = "";
  for (const c of sorted) {
    const tr = document.createElement("tr");
    if (!c.pass) tr.className = "chan-fail";
    tr.innerHTML = `
      <td class="num">${padCh(c.channel)}</td>
      <td>${c.pass ? "<span class='verdict-pass'>PASS</span>" : "<span class='verdict-fail'>FAIL</span>"}</td>
      <td class="num">${fmt(c.loss_pct, 3)}</td>
      <td class="num">${c.burst_count}/${c.longest_burst}</td>
      <td class="num">${fmt(c.jitter_ms, 2)}</td>
      <td class="num">${fmt(c.jitter_p95_ms, 2)}</td>
      <td class="num">${fmt(c.rtt_mean_ms, 2)}</td>
      <td class="num">${fmt(c.oneway_ms, 2)}</td>
      <td class="num">${fmt(c.bitrate_kbps, 0)}</td>
      <td class="num">${fmt(c.r_factor, 1)}</td>
      <td class="num">${fmt(c.mos, 2)}</td>
      <td>${mosBar(c.mos)}</td>
      <td>${channelCodec(c, profiles)}</td>`;
    body.appendChild(tr);
  }
}

// channelCodec resolves the codec used by one channel from its profile_id, e.g.
// "G.711" or "Opus 48k". Falls back to "—" if the profile can't be resolved.
function channelCodec(c, profiles) {
  const p = profiles[c.profile_id];
  if (!p) return "<span class='muted'>—</span>";
  return codecName(p.codec) + (p.codec === "opus" ? ` ${p.bitrate_kbps || 32}k` : "");
}

// ---- Create test ------------------------------------------------------------

let probeDownload = false;
let probeguiDownload = false;
fetch("/api/config").then((r) => r.json()).then((c) => {
  probeDownload = !!c.voiptesterprobe_cli_download;
  probeguiDownload = !!c.voiptesterprobe_download;
}).catch(() => {});

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
    duration_sec: (parseInt($("#f-duration").value, 10) || 30) * (parseInt($("#f-duration-unit").value, 10) || 1),
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

  // Preferred path: the pre-bound GUI probe. It carries this collector's URL and
  // the CODE inside the download, so the technician just runs it — no typing.
  const guiDl = probeguiDownload
    ? `<p class="primary-dl"><a href="/download/voiptesterprobe.exe?code=${code}" download>⬇ Download voiptesterprobe.exe (ready to connect)</a></p>
       <p class="muted">This app is pre-loaded with CODE <span class="code">${code}</span> and this collector's address. The technician just runs it inside the network under test — it connects and starts on its own, then stays in the system tray until the PC is rebooted.</p>`
    : "";

  const dl = probeDownload
    ? `<p><a href="/download/voiptesterprobe-cli.exe" download>⬇ Download voiptesterprobe-cli.exe (console)</a> — give this and the CODE to whoever runs the test.</p>`
    : `<p class="muted">Give the technician <code>voiptesterprobe-cli.exe</code> and the CODE below.</p>`;
  const simple = probeDownload ? `voiptesterprobe-cli.exe -code ${code}` : `voiptesterprobe-cli.exe -server ${origin} -code ${code}`;

  const box = $("#create-result");
  box.hidden = false;
  box.innerHTML = `
    <div>Test created — CODE <span class="code">${code}</span></div>
    ${guiDl}
    <details style="margin-top:10px">
      <summary class="muted">Prefer the console probe?</summary>
      ${dl}
      <p>On a computer inside the network under test, run:</p>
      <pre>${simple}</pre>
      <button class="btn-copy" data-copy="${simple}">copy command</button>
      <p class="muted" style="margin-top:10px">Explicit form (any probe build): <code>voiptesterprobe-cli.exe -server ${origin} -code ${code}</code></p>
    </details>`;
  box.querySelector(".btn-copy")?.addEventListener("click", (e) => {
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
// codecsLabel lists every codec in a test (e.g. "G.711, G.729") instead of
// collapsing a mixed test to "mixed". Falls back to the single summary codec.
function codecsLabel(t) {
  if (Array.isArray(t.codecs) && t.codecs.length) return t.codecs.map(codecName).join(", ");
  return codecName(t.codec);
}
// mosBar renders a small horizontal MOS quality bar (Bad red -> Excellent green,
// band widths proportional to the 1..5 scale) with a marker at this channel's MOS.
function mosBar(mos) {
  if (!mos || mos <= 0) return "<span class='muted'>—</span>";
  const pct = Math.max(0, Math.min(100, ((mos - 1) / 4) * 100));
  return `<div class="mosbar" title="MOS ${fmt(mos, 2)} — ${mosLabel(mos)}">
    <div class="mb-track">
      <span data-c="bad"  style="flex-grow:2.1"></span>
      <span data-c="poor" style="flex-grow:.5"></span>
      <span data-c="fair" style="flex-grow:.4"></span>
      <span data-c="good" style="flex-grow:.3"></span>
      <span data-c="exc"  style="flex-grow:.7"></span>
    </div>
    <i class="mb-mark" style="left:${pct}%"></i>
  </div>`;
}
// mosLabel names the quality band for a MOS value (used in the bar's tooltip).
function mosLabel(m) {
  if (m >= 4.3) return "Excellent";
  if (m >= 4.0) return "Good";
  if (m >= 3.6) return "Fair";
  if (m >= 3.1) return "Poor";
  return "Bad";
}
// fmtDate renders an ISO timestamp as a compact local date+time; "—" if absent
// or the Go zero time.
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
// Render a seconds count as a compact human duration (e.g. 90 -> "1m 30s",
// 7200 -> "2h", 172800 -> "2d").
function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return sec + "s";
  if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
  if (sec < 86400) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return h ? `${d}d ${h}h` : `${d}d`;
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

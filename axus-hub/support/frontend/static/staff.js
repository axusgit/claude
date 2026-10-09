/* ===================== Axus Hub — Service Desk console ===================== */
const Staff = (() => {
  const TOKEN_KEY = "axus-staff-token";
  const THEME_KEY = "axus-theme";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let me = null;
  let tickets = [];                 // full set
  let clientMap = {}, userMap = {}, boardMap = {}; // id -> name
  let clientsData = [];             // full customer records
  let usersData = [];               // full user records
  let boardsData = [];              // service boards
  let staffUsers = [];              // assignable
  let filter = "open";
  let current = null;               // open ticket object
  let currentCustomer = null;       // open customer object
  let cannedData = [];              // canned responses (staff saved replies)

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    document.querySelectorAll(".theme-icon").forEach(el => el.textContent = t === "dark" ? "☀️" : "🌙");
  }
  const toggleTheme = () => applyTheme((document.documentElement.getAttribute("data-theme") || "light") === "dark" ? "light" : "dark");

  /* ---------- API ---------- */
  async function api(path, { method = "GET", body, form } = {}) {
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(path, { method, headers, body: payload });
    } catch (e) {
      // A thrown fetch is usually the Authentik forward-auth bouncing us cross-origin to
      // the IdP (CORS-blocked). Confirm the SSO session and auto-reload if it's gone.
      checkSso();
      throw e;
    }
    // fetch followed a redirect to the login/IdP page instead of hitting our API.
    if (res.redirected) { checkSso(); throw new Error("Session expired"); }
    if (res.status === 401) { logout(); throw new Error("Session expired"); }
    if (!res.ok) {
      let d = res.statusText;
      try { const j = await res.json(); d = typeof j.detail === "string" ? j.detail : d; } catch (e) {}
      const err = new Error(d); err.status = res.status; throw err;
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  /* ---------- SSO session watchdog (auto-recover from an expired gateway session) ----------
     Authentik forward-auth gates this whole domain. When its session lapses, same-origin
     requests get bounced to the identity provider and the app silently hangs until a manual
     hard refresh (Ctrl+Shift+R). We poll a tiny endpoint with redirect:"manual" — an
     opaqueredirect means the gateway is sending us to login, i.e. the session is gone — and
     reload the page, which re-runs the SSO flow and restores everything automatically. */
  const AUTH_PING_MS = 3 * 60 * 1000;     // proactive check every 3 minutes
  let _authReloading = false;
  function _hasUnsavedWork() {
    // Never yank the page out from under someone mid-typing.
    const reply = document.getElementById("reply-body");
    if (reply && (reply.value || "").trim()) return true;
    const modal = document.querySelector(".modal-overlay:not(.hidden)");
    if (modal && [...modal.querySelectorAll("textarea, input[type=text], input:not([type])")]
        .some(el => (el.value || "").trim())) return true;
    return false;
  }
  function reloadForAuth() {
    if (_authReloading) return;
    const now = Date.now();
    const last = +(sessionStorage.getItem("axus-auth-reload") || 0);
    if (now - last < 20000) return;       // guard against reload loops
    if (_hasUnsavedWork()) return;        // defer — try again on the next tick
    sessionStorage.setItem("axus-auth-reload", String(now));
    _authReloading = true;
    console.warn("[sso] gateway session expired — reloading to re-authenticate");
    location.reload();
  }
  async function ssoAlive() {
    try {
      const res = await fetch("/api/health?_=" + Date.now(),
        { method: "GET", redirect: "manual", cache: "no-store" });
      return !(res.type === "opaqueredirect" || res.status === 0);
    } catch (e) { return false; }
  }
  async function checkSso() { if (!(await ssoAlive())) reloadForAuth(); }
  function startSsoWatch() {
    setInterval(checkSso, AUTH_PING_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSso(); });
    window.addEventListener("online", checkSso);
  }

  /* ---------- Live refresh (auto-update — no manual Ctrl+Shift+R needed) ----------
     The console had no live sync: a customer's portal/email reply or another tech's
     change only showed up after a hard refresh. We poll in the background and repaint
     ONLY what actually changed, so the queue and the open case stay current on their
     own. Guards below make sure we never yank away a reply being typed or a note being
     edited inline. */
  const LIVE_QUEUE_MS = 10000;    // queue + counts + dashboard
  const LIVE_DETAIL_MS = 8000;    // the open case — snappier so it feels instant
  let _queueSig = null;           // fingerprint of the last rendered queue
  let _detailSig = null;          // fingerprint of the last rendered open case
  let _detailId = null;           // which ticket _detailSig belongs to
  let _queueBusy = false, _detailBusy = false;

  // Cheap fingerprint of everything the queue renders — so we repaint only on a real
  // change and otherwise leave scroll position + selection untouched (no flicker).
  function queueSig(list) {
    return list.map(t => `${t.id}:${t.status}:${t.priority}:${t.assigned_to_id || 0}:` +
      `${t.board_id || 0}:${t.scheduled_date || ""}:${t.updated_at || t.created_at}:${t.title}`).join("|");
  }
  function detailSig(fresh, comments) {
    const last = comments.length ? comments[comments.length - 1].id : 0;
    return `${comments.length}:${last}:${fresh.updated_at || ""}:${fresh.status}:${fresh.priority}:` +
      `${fresh.assigned_to_id || 0}:${fresh.board_id || 0}:${fresh.scheduled_date || ""}`;
  }

  async function liveQueueTick() {
    if (_queueBusy || !me || document.hidden) return;
    // Only when a ticket-backed view is actually on screen.
    const live = ["queue-view", "dashboard-view", "detail-view"].some(v => $(v) && !$(v).classList.contains("hidden"));
    if (!live) return;
    _queueBusy = true;
    try {
      const fresh = await api("/api/tickets/");
      const sig = queueSig(fresh);
      if (sig !== _queueSig) {
        _queueSig = sig;
        tickets = fresh;
        renderCounts(); renderStats(); renderQueue(); renderDashboard();
      }
    } catch (e) { /* transient (offline / SSO bounce — handled by api()/the SSO watch) */ }
    finally { _queueBusy = false; }
  }

  async function liveDetailTick() {
    if (_detailBusy || !me || document.hidden) return;
    const id = current && current.id;
    // Nothing open, the read-only Xcitium mirror, or the detail isn't showing → nothing to do.
    if (!id || id < 0 || !$("detail-view") || $("detail-view").classList.contains("hidden")) { _detailSig = null; return; }
    _detailBusy = true;
    try {
      // Comments catch customer replies (portal AND email); the ticket GET catches a
      // status/priority/assignee/board/schedule change made by another tech.
      const [fresh, comments] = await Promise.all([
        api(`/api/tickets/${id}`),
        api(`/api/tickets/${id}/comments`),
      ]);
      // Bail if the user navigated away (or to another ticket) while we were fetching.
      if (!current || current.id !== id || $("detail-view").classList.contains("hidden")) return;
      const sig = detailSig(fresh, comments);
      if (_detailId !== id) { _detailId = id; _detailSig = sig; return; }  // (re)baseline on open
      if (sig === _detailSig) return;                                      // nothing changed
      _detailSig = sig;

      // Repaint the conversation — but never on top of an inline note edit in progress.
      const editingNote = !!$("thread").querySelector("textarea.edit-area");
      if (!editingNote) {
        loadThread(id).catch(() => {});
        loadActivity(id).catch(() => {});
        loadAttachments(id).catch(() => {});
        loadTime(id).catch(() => {});
      }
      // Keep badges + the editable fields in sync, without stomping a control the user
      // is actively using (focused) — e.g. an open dropdown or the schedule picker.
      syncDetailHeader(fresh);
    } catch (e) { /* transient — ticket may have been deleted elsewhere, etc. */ }
    finally { _detailBusy = false; }
  }

  // Refresh the open case's status/priority badges + editable selects from a fresh
  // server copy. Only writes a field the user isn't currently interacting with.
  function syncDetailHeader(fresh) {
    if (!current) return;
    Object.assign(current, fresh);
    const active = document.activeElement;
    const notEditing = el => el && el !== active;
    $("d-status-badge").className = "badge " + fresh.status;
    $("d-status-badge").textContent = statusLabel(fresh.status);
    $("d-prio-badge").className = "prio-badge " + fresh.priority;
    $("d-prio-badge").textContent = prioLabel(fresh.priority);
    $("d-prio-badge").title = PRIO_MEANING[fresh.priority] || "";
    $("reopen-btn").hidden = fresh.status !== "closed";
    if (notEditing($("d-status")))   $("d-status").value = fresh.status;
    if (notEditing($("d-priority"))) $("d-priority").value = fresh.priority;
    if (notEditing($("d-assignee"))) $("d-assignee").value = fresh.assigned_to_id || "";
    if (notEditing($("d-board")))    $("d-board").value = fresh.board_id || "";
    if (notEditing($("d-scheduled-date"))) $("d-scheduled-date").value = schedInputVal(fresh.scheduled_date);
    toggleScheduled(fresh.status);
    $("p-hours").textContent = (fresh.total_hours || 0) + " h";
    $("p-po").textContent = fresh.po_number || "—";
  }

  function startLiveRefresh() {
    setInterval(liveQueueTick, LIVE_QUEUE_MS);
    setInterval(liveDetailTick, LIVE_DETAIL_MS);
    // Catch up immediately when the tab regains focus / the network returns, so a
    // staff member flipping back to the console sees the latest at once.
    const burst = () => { if (!document.hidden) { liveQueueTick(); liveDetailTick(); } };
    document.addEventListener("visibilitychange", burst);
    window.addEventListener("online", burst);
    window.addEventListener("focus", burst);
  }

  /* ---------- Helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = n => (n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  // Distinct HUES (not shades of one color) so participants are easy to tell apart:
  // red, orange, yellow, green, teal, blue, indigo, violet, pink, brown.
  const AVATAR_COLORS = [
    "#E03131", // red
    "#F76707", // orange
    "#F5B800", // yellow
    "#2F9E44", // green
    "#0CA678", // teal
    "#1C7ED6", // blue
    "#4263EB", // indigo
    "#7950F2", // violet
    "#E64980", // pink
    "#A9622F", // brown
  ];
  const _hashIndex = key => {
    const s = (key || "?").toLowerCase().trim();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % AVATAR_COLORS.length;
  };
  const avatarColor = key => AVATAR_COLORS[_hashIndex(key)];
  // Bright hues (e.g. yellow) need dark text; darker ones need white. Pick per color.
  const textOn = hex => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1a1a1a" : "#fff";
  };
  const avatarStyle = hex => `background:${hex};color:${textOn(hex)}`;
  // Assign DISTINCT colors to the participants of one conversation. Each person's
  // color is seeded from their name (so it stays roughly consistent elsewhere), but
  // if two people would land on the same color we probe to the next free one — so no
  // two contributors on the same ticket ever share a color (up to the palette size).
  // items: [{ key, base }]  key = the unique identity, base = string to seed color.
  const conversationColors = items => {
    const N = AVATAR_COLORS.length, used = new Set(), map = new Map();
    for (const { key, base } of items) {
      if (map.has(key)) continue;
      let idx = _hashIndex(base), tries = 0;
      while (used.has(idx) && tries < N) { idx = (idx + 1) % N; tries++; }
      used.add(idx); map.set(key, AVATAR_COLORS[idx]);
    }
    return map;
  };
  const cap = s => (s || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  const PRIO_LABEL = { low: "Low", medium: "Normal", high: "High", critical: "Critical" };
  const prioLabel = p => PRIO_LABEL[p] || cap(p);
  const PRIO_MEANING = {
    critical: "Critical — a service or system is down or severely impacted; needs immediate attention.",
    high: "High — significant business impact; prioritized ahead of routine work.",
    medium: "Normal — a standard request handled in the normal course of business (the default priority).",
    low: "Low — a minor or non-urgent request scheduled after higher-priority work.",
  };
  const statusLabel = s => cap(s);
  // Format a date-only string ("YYYY-MM-DD") without a timezone shift.
  function schedDate(s) {
    if (!s) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return s;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  // Stored scheduled value (ISO date or date+time) -> an <input type=date> value (date part).
  function schedInputVal(s) {
    if (!s) return "";
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s));
    return m ? m[1] : "";
  }
  // Show/hide + populate the detail "Scheduled date" field based on status.
  function toggleScheduled(status) {
    const wrap = $("d-scheduled-wrap");
    if (!wrap) return;
    wrap.hidden = status !== "scheduled";
  }
  function fmtDate(s) {
    if (!s) return "";
    // Always show activity times in Axus's timezone (US Eastern, EDT/EST), not the
    // viewer's local zone. Treat timezone-naive values (no Z / offset) as UTC.
    let iso = String(s);
    if (/T\d{2}:\d{2}/.test(iso) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  }
  function fileSize(b) { if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(0) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2400); }

  // ----- reply attachments: same dashed drop-box UX as the client portal -----
  function addFilesToInput(input, fileList) {
    const dt = new DataTransfer();
    for (const f of Array.from(input.files || [])) dt.items.add(f);
    for (const f of Array.from(fileList || [])) dt.items.add(f);
    input.files = dt.files;
  }
  function wireDropzone(el, onFiles) {
    if (!el) return;
    ["dragenter", "dragover"].forEach(ev => el.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); el.classList.add("dragging");
    }));
    ["dragleave", "dragend"].forEach(ev => el.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove("dragging");
    }));
    el.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove("dragging");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) onFiles(files);
    });
  }
  // Render staged files (chips + remove ✕) for a file input into a list box.
  function renderStagedFiles(inputId, boxId, rerender) {
    const input = $(inputId), box = $(boxId);
    if (!input || !box) return;
    const files = Array.from(input.files || []);
    if (!files.length) { box.innerHTML = ""; return; }
    box.innerHTML = files.map((f, i) =>
      `<div class="nt-file">📎 ${esc(f.name)} <span class="attach-size">${fileSize(f.size)}</span> <a href="#" class="reply-file-x" data-i="${i}" title="Remove">✕</a></div>`
    ).join("");
    box.querySelectorAll(".reply-file-x").forEach(a => a.onclick = ev => {
      ev.preventDefault();
      const idx = parseInt(a.dataset.i, 10);
      const dt = new DataTransfer();
      files.forEach((f, j) => { if (j !== idx) dt.items.add(f); });
      input.files = dt.files; rerender();
    });
  }
  function renderReplyFiles() { renderStagedFiles("reply-files", "reply-file-list", renderReplyFiles); }
  function renderNtFiles() { renderStagedFiles("nt-files", "nt-file-list", renderNtFiles); }
  const ACTIVE = ["open", "in_progress", "waiting", "scheduled"];

  /* ---------- Views ---------- */
  const showLogin = async () => {
    $("login-view").classList.remove("hidden"); $("app-view").classList.add("hidden");
    // Staff use Authentik SSO in production (central). The email+password form is
    // only for the standalone 'local' dev fallback — reveal it just for that.
    let local = false;
    try { const r = await fetch("/api/auth/config"); if (r.ok) local = (await r.json()).auth_mode === "local"; } catch (e) {}
    $("login-form").classList.toggle("hidden", !local);
    $("login-sso").classList.toggle("hidden", local);
  };
  const showApp = () => { $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); requestAnimationFrame(setTopH); };
  const VIEWS = ["dashboard-view", "queue-view", "detail-view", "customers-view", "customer-detail-view", "users-view", "glossary-view", "reports-view"];
  const hideViews = () => VIEWS.forEach(id => $(id).classList.add("hidden"));
  const showDashboard = () => { hideViews(); $("dashboard-view").classList.remove("hidden"); renderDashboard(); };
  const showQueue = () => { hideViews(); $("queue-view").classList.remove("hidden"); };
  const showDetail = () => { hideViews(); $("detail-view").classList.remove("hidden"); };
  const showCustomers = () => { hideViews(); $("customers-view").classList.remove("hidden"); requestAnimationFrame(() => { fitScroller("#customers-view"); makeResizable("#customer-table", "axus-biz-widths"); }); };
  const showCustomerDetail = () => { hideViews(); $("customer-detail-view").classList.remove("hidden"); };
  const showUsers = () => { hideViews(); $("users-view").classList.remove("hidden"); requestAnimationFrame(() => { fitScroller("#users-view"); makeResizable("#user-table", "axus-usr-widths"); }); };
  // Size the scrolling table area so it fills exactly to the bottom of the viewport.
  // This makes .table-wrap the SOLE scroll container (the sticky header sticks to its
  // top) — so there's no second, page-level scroll that would drag the header away.
  function fitScroller(viewSel) {
    const view = document.querySelector(viewSel);
    if (!view || view.classList.contains("hidden")) return;
    const wrap = view.querySelector(".table-wrap");
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top;
    wrap.style.maxHeight = Math.max(200, window.innerHeight - top - 24) + "px";
  }
  function fitVisibleScroller() { ["#customers-view", "#users-view"].forEach(fitScroller); }
  // Publish the real topbar height so the sidebar sticks right below it (the 88px
  // logo makes the topbar taller than the old hard-coded 63px offset).
  function setTopH() {
    const tb = document.querySelector(".topbar");
    if (tb && tb.offsetHeight) document.documentElement.style.setProperty("--top-h", tb.offsetHeight + "px");
  }
  function syncChrome() { setTopH(); fitVisibleScroller(); }
  window.addEventListener("resize", syncChrome);
  window.addEventListener("load", syncChrome);
  const showGlossary = () => { hideViews(); $("glossary-view").classList.remove("hidden"); loadGlossary(); };
  const showReports = () => { hideViews(); $("reports-view").classList.remove("hidden"); loadReports(repPeriod); };

  /* ---------- Reports ---------- */
  let repPeriod = "month", repChart = null, ttaChart = null, ttcChart = null, companyChart = null;

  // Humanize a duration given in hours → "3.4 h" / "2.1 d" / "—".
  function fmtDur(h) {
    if (h === null || h === undefined) return "—";
    if (h < 1) return Math.round(h * 60) + " min";
    if (h < 48) return (Math.round(h * 10) / 10) + " h";
    return (Math.round(h / 24 * 10) / 10) + " d";
  }

  function loadReports(period) {
    repPeriod = period;
    document.querySelectorAll("#rep-period button").forEach(b => b.classList.toggle("active", b.dataset.p === period));
    loadTrends(period);
    loadDuration("time-to-assign", "tta", "Time to assign");
    loadDuration("time-to-close", "ttc", "Time to resolution");
    loadCompany(period);
  }

  // Open vs. closed tickets per company (top 11 + Others), stacked horizontal bars.
  async function loadCompany(period) {
    let data;
    try { data = await api("/api/reports/tickets-by-company?period=" + period); }
    catch (e) { toast("Couldn't load Tickets by company: " + e.message); return; }
    const rows = data.companies || [];
    const labels = rows.map(r => r.label);
    const open = rows.map(r => r.open);
    const closed = rows.map(r => r.closed);
    const totO = open.reduce((a, b) => a + b, 0), totC = closed.reduce((a, b) => a + b, 0);
    const per = period === "week" ? "12 weeks" : period === "month" ? "12 months" : "all time";
    $("company-summary").textContent = rows.length
      ? `${totO} open · ${totC} closed · ${rows.length} rows (${per})` : "no data yet";

    const css = getComputedStyle(document.documentElement);
    const textCol = css.getPropertyValue("--text").trim() || "#e9f0fb";
    const gridCol = css.getPropertyValue("--border").trim() || "rgba(255,255,255,.1)";
    const cfg = {
      type: "bar",
      data: { labels, datasets: [
        { label: "Open", data: open, backgroundColor: "#f26722", borderRadius: 4 },
        { label: "Closed", data: closed, backgroundColor: "#3a9d5d", borderRadius: 4 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textCol } }, tooltip: { mode: "index", intersect: false } },
        scales: {
          x: { stacked: true, ticks: { color: textCol, autoSkip: false, maxRotation: 60, minRotation: 45 }, grid: { color: gridCol } },
          y: { stacked: true, beginAtZero: true, ticks: { color: textCol, precision: 0 }, grid: { color: gridCol } },
        },
      },
    };
    if (companyChart) { companyChart.data = cfg.data; companyChart.options = cfg.options; companyChart.update(); }
    else if (window.Chart) { companyChart = new Chart($("company-chart"), cfg); }
  }

  // Shared renderer for the two duration reports (median bars, avg in tooltip).
  async function loadDuration(endpoint, key, title) {
    let data;
    try { data = await api("/api/reports/" + endpoint + "?period=" + repPeriod); }
    catch (e) { toast("Couldn't load " + title + ": " + e.message); return; }
    const labels = data.buckets.map(b => b.label);
    // Chart median in days when any value is large, else hours — keep one unit per view.
    const vals = data.buckets.map(b => b.median_hours).filter(v => v != null);
    const useDays = vals.some(v => v >= 48);
    const toUnit = h => h == null ? null : (useDays ? h / 24 : h);
    const med = data.buckets.map(b => toUnit(b.median_hours));
    const s = data.summary || {};
    const unit = useDays ? "days" : "hours";
    let summ = s.count ? `median ${fmtDur(s.median_hours)} · avg ${fmtDur(s.avg_hours)} · ${s.count} tickets` : "no data yet";
    if (key === "tta" && data.unassigned_open) summ += ` · ${data.unassigned_open} still unassigned`;
    $(key + "-summary").textContent = summ;

    const css = getComputedStyle(document.documentElement);
    const textCol = css.getPropertyValue("--text").trim() || "#e9f0fb";
    const gridCol = css.getPropertyValue("--border").trim() || "rgba(255,255,255,.1)";
    const color = key === "tta" ? "#e0872b" : "#2f7fd6";
    const cfg = {
      type: "bar",
      data: { labels, datasets: [{ label: "Median (" + unit + ")", data: med, backgroundColor: color, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textCol } },
          tooltip: { callbacks: { label: (ctx) => {
            const b = data.buckets[ctx.dataIndex];
            return b.count ? [`Median: ${fmtDur(b.median_hours)}`, `Average: ${fmtDur(b.avg_hours)}`, `${b.count} tickets`] : "No tickets";
          } } },
        },
        scales: {
          x: { ticks: { color: textCol }, grid: { color: gridCol } },
          y: { beginAtZero: true, ticks: { color: textCol }, grid: { color: gridCol }, title: { display: true, text: unit, color: textCol } },
        },
      },
    };
    const chart = key === "tta" ? ttaChart : ttcChart;
    if (chart) { chart.data = cfg.data; chart.options = cfg.options; chart.update(); }
    else if (window.Chart) {
      const c = new Chart($(key + "-chart"), cfg);
      if (key === "tta") ttaChart = c; else ttcChart = c;
    }
  }

  async function loadTrends(period) {
    repPeriod = period;
    document.querySelectorAll("#rep-period button").forEach(b => b.classList.toggle("active", b.dataset.p === period));
    let data;
    try { data = await api("/api/reports/ticket-trends?period=" + period); }
    catch (e) { toast("Couldn't load report: " + e.message); return; }
    const labels = data.buckets.map(b => b.label);
    const opened = data.buckets.map(b => b.opened);
    const closed = data.buckets.map(b => b.closed);
    const totO = opened.reduce((a, b) => a + b, 0), totC = closed.reduce((a, b) => a + b, 0);
    const per = period === "week" ? "12 weeks" : period === "month" ? "12 months" : "all years";
    $("rep-summary").textContent = `${totO} opened · ${totC} closed (${per})`;
    const css = getComputedStyle(document.documentElement);
    const textCol = css.getPropertyValue("--text").trim() || "#e9f0fb";
    const gridCol = (css.getPropertyValue("--border").trim() || "rgba(255,255,255,.1)");
    const cfg = {
      type: "bar",
      data: { labels, datasets: [
        { label: "Opened", data: opened, backgroundColor: "#f26722", borderRadius: 4 },
        { label: "Closed", data: closed, backgroundColor: "#3a9d5d", borderRadius: 4 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textCol } }, tooltip: { mode: "index", intersect: false } },
        scales: {
          x: { ticks: { color: textCol }, grid: { color: gridCol } },
          y: { beginAtZero: true, ticks: { color: textCol, precision: 0 }, grid: { color: gridCol } },
        },
      },
    };
    if (repChart) { repChart.data = cfg.data; repChart.options = cfg.options; repChart.update(); }
    else if (window.Chart) { repChart = new Chart($("rep-chart"), cfg); }
  }

  /* ---------- Auth ---------- */
  async function login(email, password) {
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    });
    if (!res.ok) { let m = "Invalid email or password"; try { const j = await res.json(); if (typeof j.detail === "string") m = j.detail; } catch (e) {} throw new Error(m); }
    token = (await res.json()).access_token;
    localStorage.setItem(TOKEN_KEY, token);
  }
  function logout() { token = null; me = null; localStorage.removeItem(TOKEN_KEY); showLogin(); }

  async function loadAll() {
    me = await api("/api/auth/me");
    if (me.role === "client") { logout(); throw new Error("Use the client portal to sign in"); }
    $("who-name").textContent = me.full_name;
    $("who-role").textContent = "";   // don't surface the role in the topbar
    $("profile-av").textContent = initials(me.full_name);
    const _meColor = avatarColor(me.full_name);
    $("profile-av").style.background = _meColor;
    $("profile-av").style.color = textOn(_meColor);
    $("pm-name").textContent = me.full_name;
    $("pm-email").textContent = me.email;
    // Only admins may change system configuration (users/access). Technicians get
    // everything else; the config UI is hidden for them.
    const isAdmin = me.role === "admin";
    const usersNav = $("users-dd-btn") ? $("users-dd-btn").closest(".nav-dd") : null;
    if (usersNav) usersNav.style.display = isAdmin ? "" : "none";
    if ($("cd-adduser-btn")) $("cd-adduser-btn").style.display = isAdmin ? "" : "none";
    if ($("xnum-btn")) $("xnum-btn").hidden = !isAdmin;   // admin-only Xcitium # import
    const [cl, us, bd] = await Promise.all([api("/api/clients/"), api("/api/users/"), api("/api/boards/")]);
    clientsData = cl; usersData = us; boardsData = bd;
    clientMap = {}; cl.forEach(c => clientMap[c.id] = c.company_name);
    userMap = {}; us.forEach(u => userMap[u.id] = u.full_name);
    boardMap = {}; bd.forEach(b => boardMap[b.id] = b.name);
    loadCanned();   // populate the reply "Canned…" picker on login
    staffUsers = us.filter(u => u.role !== "client");
    $("c-customers").textContent = cl.length;
    $("c-users").textContent = us.length;
    // populate company + assignee + board selects
    fillClientSelects();
    fillSelect($("nt-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    fillSelect($("d-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    fillSelect($("nt-board"), bd.map(b => [b.id, b.name]), "— None —");
    fillSelect($("d-board"), bd.map(b => [b.id, b.name]), "— None —");
    renderBoardNav();
    await loadTickets();
  }

  // (Re)populate every business dropdown from clientsData, preserving the current
  // selection. Called at startup AND whenever a business is added/edited, so a new
  // business shows up immediately without a page reload.
  function fillClientSelects() {
    // Alphabetical so a newly-added business slots into the right place (not the bottom).
    const pairs = clientsData.slice()
      .sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "", undefined, { numeric: true, sensitivity: "base" }))
      .map(c => [c.id, c.company_name]);
    [["f-client", "All companies"], ["nt-client", null], ["uf-client", "— None —"], ["d-business", null]].forEach(([id, ph]) => {
      const el = $(id); if (!el) return;
      const prev = el.value;
      fillSelect(el, pairs, ph);
      if (prev) el.value = prev;
    });
  }
  function fillSelect(sel, pairs, placeholder) {
    sel.innerHTML = (placeholder !== null ? `<option value="">${placeholder}</option>` : "") +
      pairs.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  }

  async function loadTickets() { tickets = await api("/api/tickets/"); _queueSig = queueSig(tickets); renderCounts(); renderStats(); renderQueue(); renderDashboard(); }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    if (!me) return;
    const native = tickets.filter(t => t.source !== "xcitium");
    const active = native.filter(t => ACTIVE.includes(t.status));
    const unassigned = active.filter(t => !t.assigned_to_id);
    const mine = active.filter(t => t.assigned_to_id === me.id);
    const waiting = native.filter(t => t.status === "waiting").length;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const closedToday = native.filter(t => t.status === "closed" && t.closed_at && new Date(t.closed_at) >= midnight).length;
    const imported = tickets.filter(t => t.source === "xcitium" && ACTIVE.includes(t.status)).length;

    const tile = (n, label, cls, flt) =>
      `<button class="stat-card dash-tile ${cls}" data-flt="${flt || ""}"><div class="stat-num">${n}</div><div class="stat-label">${label}</div></button>`;
    $("dash-tiles").innerHTML =
      tile(active.length, "Open", "accent", "open") +
      tile(unassigned.length, "Unassigned", unassigned.length ? "danger" : "", "unassigned") +
      tile(mine.length, "My open", "", "mine") +
      tile(waiting, "Waiting on client", "", "waiting") +
      tile(closedToday, "Closed today", "good", "closed");
    $("dash-tiles").querySelectorAll(".dash-tile").forEach(b => {
      b.onclick = () => {
        const f = b.dataset.flt; if (!f) return;
        filter = f;
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        const nav = document.querySelector(`.nav-item[data-filter="${f}"]`); if (nav) nav.classList.add("active");
        showQueue(); renderQueue();
      };
    });

    const rowHtml = t => `<div class="dash-row" data-id="${t.id}">
        <span class="dash-ref">${esc(t.reference || "")}</span>
        <span class="dash-title">${esc(t.title)}</span>
        <span class="dash-status"><span class="badge ${t.status}">${cap(t.status)}</span>${t.status === "scheduled" && t.scheduled_date ? `<span class="sched-date">${schedDate(t.scheduled_date)}</span>` : ""}</span>
        <span class="dash-co cell-muted">${esc(t.client_name || clientMap[t.client_id] || "—")}</span>
      </div>`;
    const fill = (elId, rows, empty) => {
      const el = $(elId);
      el.innerHTML = rows.length ? rows.slice(0, 12).map(rowHtml).join("") : `<div class="muted dash-empty">${empty}</div>`;
      el.querySelectorAll(".dash-row").forEach(r => r.onclick = () => openTicket(parseInt(r.dataset.id)));
    };
    fill("dash-mine", mine, "Nothing assigned to you.");
    $("dash-mine-count").textContent = `(${mine.length})`;

    const load = {};
    staffUsers.forEach(u => load[u.id] = 0);
    active.forEach(t => { if (t.assigned_to_id != null && load[t.assigned_to_id] != null) load[t.assigned_to_id]++; });
    const maxLoad = Math.max(1, ...Object.values(load));
    const team = staffUsers.map(u => ({ u, n: load[u.id] || 0 })).sort((a, b) => b.n - a.n);
    $("dash-team").innerHTML = team.length ? team.map(({ u, n }) => `
      <div class="dash-team-row">
        <span class="mini-avatar" style="${avatarStyle(avatarColor(u.full_name))}">${initials(u.full_name)}</span>
        <span class="dash-team-name">${esc(u.full_name)}</span>
        <span class="dash-team-bar"><span style="width:${Math.round((n / maxLoad) * 100)}%"></span></span>
        <span class="dash-team-n">${n}</span>
      </div>`).join("") : `<div class="muted">No staff yet.</div>`;

    $("dash-sub").textContent = `${active.length} open · ${unassigned.length} unassigned`
      + (imported ? ` · ${imported} imported (read-only)` : "");
  }

  /* ---------- Queue ---------- */
  function matchesFilter(t) {
    if (filter.startsWith("board:")) return t.board_id === parseInt(filter.slice(6));
    switch (filter) {
      case "open": return ACTIVE.includes(t.status);
      case "unassigned": return ACTIVE.includes(t.status) && !t.assigned_to_id;
      case "assigned": return ACTIVE.includes(t.status) && !!t.assigned_to_id;
      case "mine": return ACTIVE.includes(t.status) && t.assigned_to_id === me.id;
      case "waiting": return t.status === "waiting";
      case "in_progress": return t.status === "in_progress";
      case "closed": return t.status === "closed";
      default: return true; // all
    }
  }
  function renderCounts() {
    const c = f => tickets.filter(t => {
      const saved = filter; filter = f; const r = matchesFilter(t); filter = saved; return r;
    }).length;
    $("c-open").textContent = c("open"); $("c-unassigned").textContent = c("unassigned");
    $("c-assigned").textContent = c("assigned");
    $("c-mine").textContent = c("mine"); $("c-closed").textContent = c("closed");
    $("c-all").textContent = tickets.length;
    boardsData.forEach(b => { const el = $("bc-" + b.id); if (el) el.textContent = tickets.filter(t => t.board_id === b.id).length; });
  }
  function renderBoardNav() {
    const nav = $("board-nav");
    nav.innerHTML = boardsData.map(b =>
      `<a data-board="${b.id}" class="nav-item">${esc(b.name)} <span class="nav-count" id="bc-${b.id}"></span></a>`).join("");
    nav.querySelectorAll(".nav-item").forEach(item => {
      item.onclick = () => {
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        item.classList.add("active");
        filter = "board:" + item.dataset.board;
        showQueue(); renderQueue();
      };
    });
  }
  function renderStats() {
    const open = tickets.filter(t => ACTIVE.includes(t.status)).length;
    const unassigned = tickets.filter(t => ACTIVE.includes(t.status) && !t.assigned_to_id).length;
    const inprog = tickets.filter(t => t.status === "in_progress").length;
    const closed = tickets.filter(t => t.status === "closed").length;
    $("stats-row").innerHTML = `
      ${statCard(open, "Open tickets", "accent")}
      ${statCard(unassigned, "Unassigned", unassigned ? "danger" : "")}
      ${statCard(inprog, "In progress", "")}
      ${statCard(closed, "Closed", "good")}`;
  }
  const statCard = (n, label, cls) => `<div class="stat-card ${cls}"><div class="stat-num">${n}</div><div class="stat-label">${label}</div></div>`;

  const _PRIO_RANK = { urgent: 4, high: 3, normal: 2, low: 1 };
  const _STATUS_RANK = { open: 1, in_progress: 2, waiting: 3, resolved: 4, closed: 5 };
  function queueVal(t, key) {
    switch (key) {
      case "ref": return t.reference || "";
      case "subject": return t.title || "";
      case "company": return t.client_name || clientMap[t.client_id] || "";
      case "board": return boardMap[t.board_id] || "";
      case "priority": return _PRIO_RANK[t.priority] || 0;
      case "status": return _STATUS_RANK[t.status] || 0;
      case "assignee": return t.assigned_to_id ? (userMap[t.assigned_to_id] || "") : "";
      case "created": return new Date(t.created_at).getTime();
      case "updated": return new Date(t.updated_at || t.created_at).getTime();
      default: return "";
    }
  }
  function renderQueue() {
    const q = ($("search").value || "").toLowerCase();
    const fp = $("f-priority").value, fc = $("f-client").value, fs = $("f-status").value;
    // Imported Xcitium tickets have no native client_id (0); they carry the company
    // as client_name. Match the selected business by id OR by name so those rows
    // (e.g. RL Carriers' closed cases) are included.
    const fcName = fc ? (clientMap[fc] || "").trim().toLowerCase() : "";
    const rows = tickets.filter(matchesFilter).filter(t => {
      if (fs && t.status !== fs) return false;
      if (fp && t.priority !== fp) return false;
      if (fc) {
        const byId = String(t.client_id) === fc;
        const byName = fcName && (t.client_name || "").trim().toLowerCase() === fcName;
        if (!byId && !byName) return false;
      }
      if (q) {
        const hay = `${t.reference} ${t.title} ${t.client_name || clientMap[t.client_id] || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => queueSort.dir * cmpVals(queueVal(a, queueSort.key), queueVal(b, queueSort.key)));

    $("queue-title").textContent = `${rows.length} ticket${rows.length === 1 ? "" : "s"}`;
    const tbody = $("ticket-rows"); tbody.innerHTML = "";
    $("queue-empty").classList.toggle("hidden", rows.length > 0);
    for (const t of rows) {
      const tr = document.createElement("tr");
      tr.onclick = () => openTicket(t.id);
      const aName = t.assigned_to_id ? userMap[t.assigned_to_id] : null;
      tr.innerHTML = `
        <td class="cell-ref col-ref">${esc(t.reference || "")}${t.source === "xcitium" ? ' <span class="src-tag" title="Imported from Xcitium (read-only)">Xcitium</span>' : ""}</td>
        <td class="cell-subject col-subject">${esc(t.title)}</td>
        <td class="cell-muted col-company">${esc(t.client_name || clientMap[t.client_id] || "—")}</td>
        <td class="cell-muted col-board">${t.board_id ? esc(boardMap[t.board_id] || "—") : "—"}</td>
        <td class="col-priority"><span class="prio-dot prio ${t.priority}">${prioLabel(t.priority)}</span></td>
        <td class="col-status"><span class="badge ${t.status}">${cap(t.status)}</span>${t.status === "scheduled" && t.scheduled_date ? `<div class="sched-date">${schedDate(t.scheduled_date)}</div>` : ""}</td>
        <td class="col-assignee">${aName
          ? `<span class="assignee-pill"><span class="mini-avatar" style="${avatarStyle(avatarColor(aName))}">${initials(aName)}</span>${esc(aName)}</span>`
          : `<span class="assignee-pill"><span class="mini-avatar none">?</span><span class="cell-muted">Unassigned</span></span>`}</td>
        <td class="cell-muted col-created">${fmtDate(t.created_at)}</td>
        <td class="cell-muted col-updated">${fmtDate(t.updated_at || t.created_at)}</td>`;
      tbody.appendChild(tr);
    }
    applyColumns();
  }

  /* ---------- Column chooser ---------- */
  const COLUMNS = [
    { key: "ref", label: "Ref" }, { key: "subject", label: "Subject" },
    { key: "company", label: "Business" }, { key: "board", label: "Board" },
    { key: "priority", label: "Priority" }, { key: "status", label: "Status" },
    { key: "assignee", label: "Assignee" }, { key: "created", label: "Created" },
    { key: "updated", label: "Updated" },
  ];
  const COLS_KEY = "axus-staff-hidden-cols";
  let hiddenCols = new Set(JSON.parse(localStorage.getItem(COLS_KEY) || "[]"));

  function applyColumns() {
    COLUMNS.forEach(c => {
      const hide = hiddenCols.has(c.key);
      document.querySelectorAll(`#ticket-table .col-${c.key}`).forEach(el => el.style.display = hide ? "none" : "");
    });
  }
  function renderColsMenu() {
    $("cols-menu").innerHTML = COLUMNS.map(c =>
      `<label class="col-opt"><input type="checkbox" data-col="${c.key}" ${hiddenCols.has(c.key) ? "" : "checked"} /> ${c.label}</label>`).join("");
    $("cols-menu").querySelectorAll("input").forEach(i => i.onchange = () => {
      if (i.checked) hiddenCols.delete(i.dataset.col); else hiddenCols.add(i.dataset.col);
      localStorage.setItem(COLS_KEY, JSON.stringify([...hiddenCols]));
      applyColumns();
    });
  }

  // Reusable show/hide-columns chooser (Business + Users), scoped by table id so the
  // tables don't clash on shared column keys. Selection persists per-user via storage.
  let applyBizCols = () => {};
  let applyUsrCols = () => {};
  function setupColumnChooser({ tableSel, columns, storageKey, btnId, menuId }) {
    let hidden = new Set();
    try { hidden = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch (e) {}
    const apply = () => columns.forEach(c => {
      const hide = hidden.has(c.key);
      document.querySelectorAll(`${tableSel} .col-${c.key}`).forEach(el => el.style.display = hide ? "none" : "");
    });
    $(menuId).innerHTML = columns.map(c =>
      `<label class="col-opt"><input type="checkbox" data-col="${c.key}" ${hidden.has(c.key) ? "" : "checked"} /> ${c.label}</label>`).join("");
    $(menuId).querySelectorAll("input").forEach(i => i.onchange = () => {
      if (i.checked) hidden.delete(i.dataset.col); else hidden.add(i.dataset.col);
      try { localStorage.setItem(storageKey, JSON.stringify([...hidden])); } catch (e) {}
      apply();
    });
    $(btnId).onclick = e => { e.stopPropagation(); $(menuId).classList.toggle("hidden"); };
    $(menuId).onclick = e => e.stopPropagation();
    document.addEventListener("click", () => $(menuId).classList.add("hidden"));
    return apply;
  }

  // Make a table's columns drag-resizable (a delimiter on each header's right edge).
  // Runs once per table; widths persist per-user. The last column is left flexible so
  // the table always fills the width. Must run while the table is visible.
  function makeResizable(tableSel, storageKey) {
    const table = document.querySelector(tableSel);
    if (!table || table.dataset.resizable) return;
    const ths = [...table.querySelectorAll("thead th")];
    if (!ths.length || !ths[0].offsetWidth) return;   // hidden/not laid out yet — retry on next show
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (e) {}
    ths.forEach((th, i) => {
      if (i < ths.length - 1) th.style.width = (saved[i] || th.offsetWidth) + "px";
      // Don't clobber position:sticky (an inline value would defeat the sticky
      // header). Sticky already establishes a containing block for the absolute
      // resize handle, so only add relative when the header isn't positioned.
      if (getComputedStyle(th).position === "static") th.style.position = "relative";
    });
    table.style.tableLayout = "fixed";
    ths.forEach((th, i) => {
      if (i === ths.length - 1) return;   // last column flexes; no handle
      const h = document.createElement("span");
      h.className = "col-resize";
      th.appendChild(h);
      h.addEventListener("click", e => e.stopPropagation());
      h.addEventListener("mousedown", e => {
        e.preventDefault();
        const startX = e.pageX, startW = th.offsetWidth;
        document.body.style.userSelect = "none";
        const move = ev => { th.style.width = Math.max(48, startW + ev.pageX - startX) + "px"; };
        const up = () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          document.body.style.userSelect = "";
          saved[i] = th.offsetWidth;
          try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (e) {}
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
    });
    table.dataset.resizable = "1";
  }

  /* ---------- Detail ---------- */
  // Elements that only make sense for editable native tickets; hidden for the
  // read-only Xcitium mirror.
  function _detailEditableEls() {
    return [
      $("convert-project-btn"), $("edit-ticket-btn"),
      document.querySelector(".control-row"),
      $("reply-form"),
      $("time-form") && $("time-form").closest(".card"),
      $("attach-list") && $("attach-list").closest(".card"),
      $("tu-list") && $("tu-list").closest(".card"),
      $("activity") && $("activity").closest(".card"),
    ].filter(Boolean);
  }
  function applyReadonly(on) {
    _detailEditableEls().forEach(el => { el.style.display = on ? "none" : ""; });
  }

  // Xcitium comment bodies are rich HTML emails; render them as safe, readable
  // text (keep line breaks, drop tags/scripts) rather than raw markup.
  function htmlToText(html) {
    if (!html) return "";
    let s = html.replace(/<\s*(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "");
    const ta = document.createElement("textarea"); ta.innerHTML = s;
    return ta.value.replace(/\n{3,}/g, "\n\n").trim();
  }

  async function openXcitiumTicket(externalId) {
    const t = await api(`/api/xcitium/tickets/${externalId}`);
    current = { id: -externalId, source: "xcitium" };
    applyReadonly(true);
    $("delete-ticket-btn").hidden = true;
    $("promote-btn").hidden = false;   // "Edit ticket" → import into Axus as editable
    $("d-ref").textContent = `X-${externalId}`;
    $("d-status-badge").className = "badge"; $("d-status-badge").textContent = t.status || "";
    $("d-prio-badge").className = "prio-badge"; $("d-prio-badge").textContent = t.priority || "";
    $("reopen-btn").hidden = true;   // not applicable to read-only imported tickets
    $("d-title").textContent = t.subject || "(no subject)";
    $("d-desc").textContent = (t.threads && t.threads.length)
      ? htmlToText(t.threads[0].body) : (t.subject || "No description provided.");
    $("p-company").textContent = t.organization || "—";
    $("p-contact").textContent = t.user || "—";
    $("p-project").textContent = "—";
    $("p-category").textContent = t.category || "Uncategorized";
    $("p-type").textContent = "Imported (Xcitium)";
    $("p-hours").textContent = "—";
    $("p-phone").textContent = "—";
    $("p-address").textContent = "—";
    $("p-created").textContent = fmtDate(t.created);
    // render the conversation read-only
    const el = $("thread");
    const xKey = th => th.poster || t.user || "?";
    const xColors = conversationColors((t.threads || []).map(th => ({ key: xKey(th), base: xKey(th) })));
    el.innerHTML = (t.threads && t.threads.length)
      ? t.threads.slice().reverse().map(th => `<div class="msg them">
          <div class="msg-avatar" style="${avatarStyle(xColors.get(xKey(th)))}">${initials(xKey(th))}</div>
          <div class="msg-bubble"><div class="msg-meta">${esc(th.poster || "—")} · ${fmtDate(th.created)}</div>
          <div class="msg-body">${esc(htmlToText(th.body)).replace(/\n/g, "<br>")}</div></div></div>`).join("")
      : `<div class="thread-empty">No messages.</div>`;
    showDetail();
  }

  async function openTicket(id) {
    if (id < 0) return openXcitiumTicket(-id);   // Xcitium mirror rows use negative ids
    applyReadonly(false);
    current = await api(`/api/tickets/${id}`);
    $("d-ref").textContent = current.reference || "";
    $("d-status-badge").className = "badge " + current.status;
    $("d-status-badge").textContent = statusLabel(current.status);
    $("reopen-btn").hidden = current.status !== "closed";   // staff-only reopen for closed tickets
    $("d-prio-badge").className = "prio-badge " + current.priority;
    $("d-prio-badge").textContent = prioLabel(current.priority);
    $("d-prio-badge").title = PRIO_MEANING[current.priority] || "";
    $("d-title").textContent = current.title;
    $("d-desc").textContent = current.description || "No description provided.";
    $("d-status").value = current.status;
    $("d-scheduled-date").value = schedInputVal(current.scheduled_date);
    toggleScheduled(current.status);
    $("d-priority").value = current.priority;
    $("d-assignee").value = current.assigned_to_id || "";
    $("d-board").value = current.board_id || "";
    $("d-origin").value = current.origin || "";
    $("d-business").value = current.client_id ? String(current.client_id) : "";
    $("p-company").textContent = clientMap[current.client_id] || "—";
    $("p-category").textContent = current.category || "Uncategorized";
    const isProject = current.ticket_type === "sow";
    $("p-type").textContent = isProject ? "Project (SOW)" : "Standard";
    $("convert-project-btn").style.display = isProject ? "none" : "";  // hide once it's a project
    $("delete-ticket-btn").hidden = !(me && me.role === "admin");      // admins only
    $("promote-btn").hidden = true;                                    // native tickets are already editable
    $("p-hours").textContent = (current.total_hours || 0) + " h";
    $("p-phone").textContent = current.contact_phone || "—";
    $("p-po").textContent = current.po_number || "—";
    $("p-address").textContent = current.contact_address || "—";
    $("p-created").textContent = fmtDate(current.created_at);
    // "Opened by": the client contact the case is for and, when a staff member
    // opened it on the client's behalf, that staff member too ("Client / Staff").
    // Only origin "axus_tech" means staff genuinely opened it themselves — every
    // other origin (client portal/email/phone, monitoring, Xcitium imports) is
    // client/system-originated, so we must NOT attribute it to a staff member even
    // though created_by_id points at a tech or the "Email Intake" system account.
    // Staff-only — this is the staff console; the client portal never shows it.
    const staffOpener = (current.origin === "axus_tech" && current.created_by_id)
      ? staffUsers.find(u => u.id === current.created_by_id) : null;
    const setOpenedBy = clientName => {
      const parts = [];
      if (clientName) parts.push(clientName);
      if (staffOpener) parts.push(staffOpener.full_name);
      $("p-contact").textContent = parts.length ? parts.join(" / ") : "—";
    };
    if (current.reporter_user_id) {
      try { const us = await api(`/api/clients/${current.client_id}/portal-users`); const u = us.find(x => x.id === current.reporter_user_id); setOpenedBy(u ? u.full_name : null); }
      catch (e) { setOpenedBy(null); }
    } else { setOpenedBy(null); }
    $("reply-internal").checked = false; $("reply-form").classList.remove("internal-mode");
    $("reply-files").value = ""; renderReplyFiles();   // clear files staged on the previous ticket
    $("reply-body").style.height = "";   // back to the default height on every ticket open (undo any drag-resize)
    showDetail();
    await Promise.all([loadThread(id), loadTime(id), loadAttachments(id), loadActivity(id), loadWatchers(id), loadProjectLinks(current)]);
  }

  /* ---------- Projects (parent ticket ↔ associated tickets) ---------- */
  function loadProjectsInto(selectEl, excludeId) {
    const projects = tickets.filter(t => t.ticket_type === "sow" && t.id !== excludeId);
    selectEl.innerHTML = `<option value="">— None —</option>` +
      projects.map(p => `<option value="${p.id}">${esc(p.reference || ("#" + p.id))} · ${esc(p.title)}</option>`).join("");
  }
  async function loadProjectLinks(t) {
    // (a) if this ticket belongs to a project, show a link to it in Properties
    if (t.project_id) {
      const p = tickets.find(x => x.id === t.project_id);
      $("p-project").innerHTML = `<a class="tu-link" id="p-project-link">${p ? esc(p.reference || ("#" + p.id)) : "Project"}</a>`;
      const link = $("p-project-link"); if (link) link.onclick = () => openTicket(t.project_id);
    } else {
      $("p-project").textContent = "—";
    }
    // (b) if this ticket IS a project, list its associated tickets + all project files
    const card = $("project-tickets-card");
    if (t.ticket_type === "sow") {
      card.hidden = false;
      const kids = await api(`/api/tickets/${t.id}/children`);
      $("pt-count").textContent = `(${kids.length})`;
      $("pt-list").innerHTML = kids.length
        ? kids.map(k => `<div class="pt-item" data-id="${k.id}"><span class="pt-ref">${esc(k.reference || ("#" + k.id))}</span>` +
            `<span class="pt-title">${esc(k.title)}</span><span class="badge ${k.status}">${cap(k.status)}</span></div>`).join("")
        : `<div class="muted">No tickets in this project yet.</div>`;
      $("pt-list").querySelectorAll(".pt-item").forEach(el => el.onclick = () => openTicket(Number(el.dataset.id)));
      await loadProjectAttachments(t.id);
    } else {
      card.hidden = true;
      $("project-files-card").hidden = true;
    }
  }
  async function loadProjectAttachments(projectId) {
    const files = await api(`/api/tickets/${projectId}/project-attachments`);
    $("project-files-card").hidden = false;
    $("pf-count").textContent = `(${files.length})`;
    $("pf-list").innerHTML = files.length
      ? files.map(f => `<div class="pf-item">
          <span class="pf-ico">📄</span>
          <a class="pf-name" data-att="${f.id}" data-tid="${f.ticket_id}" data-fn="${esc(f.filename)}">${esc(f.filename)}</a>
          <span class="pf-src">${esc(f.ticket_reference || ("#" + f.ticket_id))}</span>
          <span class="pf-time">${fmtDate(f.created_at)}</span>
          <span class="attach-size">${fileSize(f.size)}</span>
        </div>`).join("")
      : `<div class="muted">No files uploaded to this project yet.</div>`;
    $("pf-list").querySelectorAll(".pf-name").forEach(a => {
      a.onclick = ev => { ev.preventDefault(); download(Number(a.dataset.att), a.dataset.fn, Number(a.dataset.tid)); };
    });
  }

  /* ---------- Ticket users (reporter + up to 9 additional) ---------- */
  const MAX_ADDITIONAL_USERS = 10;
  async function loadWatchers(ticketId) {
    const [watchers, businessUsers] = await Promise.all([
      api(`/api/tickets/${ticketId}/watchers`),
      api(`/api/clients/${current.client_id}/portal-users`).catch(() => []),
    ]);
    // reporter is shown first and is not removable
    const reporter = current.reporter_user_id
      ? businessUsers.find(u => u.id === current.reporter_user_id) : null;
    let html = "";
    if (reporter) {
      html += `<div class="time-item"><span>${esc(reporter.full_name)} <span class="tu-tag">Opened</span><br>` +
              `<span class="cell-muted">${esc(reporter.email)}</span></span></div>`;
    }
    html += watchers.map(w => `<div class="time-item"><span>${esc(w.full_name)}<br>` +
      `<span class="cell-muted">${esc(w.email)}</span></span>` +
      `<button class="btn btn-ghost btn-xs tu-remove" data-uid="${w.id}" title="Remove">Remove</button></div>`).join("");
    if (!reporter && !watchers.length) html = `<div class="muted">No users on this ticket yet.</div>`;
    $("tu-list").innerHTML = html;
    $("tu-count").textContent = `(${watchers.length}/${MAX_ADDITIONAL_USERS} added)`;
    $("tu-list").querySelectorAll(".tu-remove").forEach(b => {
      b.onclick = async () => {
        await api(`/api/tickets/${ticketId}/watchers/${b.dataset.uid}`, { method: "DELETE" });
        await loadWatchers(ticketId); toast("User removed");
      };
    });
    // eligible = business users who aren't the reporter and aren't already added
    const taken = new Set([current.reporter_user_id, ...watchers.map(w => w.id)]);
    const eligible = businessUsers.filter(u => !taken.has(u.id));
    const atMax = watchers.length >= MAX_ADDITIONAL_USERS;
    const wrap = $("tu-add-wrap");
    if (atMax) {
      wrap.innerHTML = `<p class="muted tu-hint">Maximum of ${MAX_ADDITIONAL_USERS} additional users reached.</p>`;
    } else {
      let h = "";
      if (eligible.length) {
        h += `<div class="tu-add"><select id="tu-select">` +
          eligible.map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.email)})</option>`).join("") +
          `</select><button type="button" class="btn btn-primary btn-xs" id="tu-add-btn">+ Add</button></div>`;
      }
      // add anyone by email (Axus users or external), like the client portal
      h += `<div class="tu-add"><input type="email" id="tu-email" placeholder="or add by email…" autocomplete="off" />` +
        `<button type="button" class="btn btn-ghost btn-xs" id="tu-email-btn">+ Add</button></div>`;
      if (!eligible.length) {
        h += `<p class="muted tu-hint">No other users in this business — add by email above, or create them under ` +
          `<a id="tu-goto-biz" class="tu-link">Business → Users</a>.</p>`;
      }
      wrap.innerHTML = h;
      if (eligible.length) $("tu-add-btn").onclick = addWatcher;
      $("tu-email-btn").onclick = addWatcherEmail;
      $("tu-email").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addWatcherEmail(); } };
      const link = $("tu-goto-biz");
      if (link) link.onclick = () => openCustomer(current.client_id);
    }
  }
  async function convertToProject() {
    if (!current || current.ticket_type === "sow") return;
    if (!await axusConfirm("Convert this ticket into a Project? It will move to the Projects board and be assigned.")) return;
    try {
      await api(`/api/tickets/${current.id}/convert-to-project`, { method: "POST" });
      await loadTickets(); await openTicket(current.id);
      toast("Converted to Project");
    } catch (e) { toast(e.message); }
  }

  async function addWatcher() {
    const uid = $("tu-select").value;
    if (!uid) return;
    try {
      await api(`/api/tickets/${current.id}/watchers`, { method: "POST", body: { user_id: parseInt(uid) } });
      await loadWatchers(current.id); toast("User added");
    } catch (e) { toast(e.message); }
  }
  async function addWatcherEmail() {
    const email = $("tu-email").value.trim();
    if (!email) return;
    try {
      await api(`/api/tickets/${current.id}/watchers`, { method: "POST", body: { email } });
      await loadWatchers(current.id); toast("User added");
    } catch (e) { toast(e.message); }
  }

  async function loadThread(id) {
    const comments = await api(`/api/tickets/${id}/comments`);
    const el = $("thread");
    if (!comments.length) { el.innerHTML = `<div class="thread-empty">No replies yet.</div>`; return; }
    const cColors = conversationColors(comments.map(c => ({
      key: String(c.author_id),
      base: userMap[c.author_id] || (c.author_id === me.id ? "You" : "User"),
    })));
    el.innerHTML = comments.slice().reverse().map(c => {   // newest on top, oldest at the bottom
      const mine = c.author_id === me.id;
      const who = userMap[c.author_id] || (mine ? "You" : "User");
      const canEdit = me.role === "admin" || c.author_id === me.id;
      return `<div class="msg ${mine ? "me" : "them"} ${c.is_internal ? "internal" : ""}">
        <div class="msg-avatar" style="${avatarStyle(cColors.get(String(c.author_id)))}">${initials(who)}</div>
        <div class="msg-bubble">
          <div class="msg-meta">${esc(who)} · ${fmtDate(c.created_at)} ${c.is_internal ? '<span class="internal-tag">Internal</span>' : ""}
            ${canEdit ? `<span class="msg-actions"><a class="msg-edit" data-cid="${c.id}">Edit</a><a class="msg-del" data-cid="${c.id}">Delete</a></span>` : ""}</div>
          <div class="msg-body" data-cid="${c.id}">${esc(c.body)}</div>
        </div></div>`;
    }).join("");
    el.querySelectorAll(".msg-edit").forEach(b => b.onclick = () => editComment(id, b.dataset.cid));
    el.querySelectorAll(".msg-del").forEach(b => b.onclick = () => delComment(id, b.dataset.cid));
  }

  function editComment(ticketId, cid) {
    const body = document.querySelector(`.msg-body[data-cid="${cid}"]`);
    if (!body || body.querySelector("textarea")) return;
    const cur = body.textContent;
    body.innerHTML = `<textarea class="edit-area" rows="3"></textarea>
      <div class="edit-actions"><button class="btn btn-ghost edit-cancel">Cancel</button><button class="btn btn-primary edit-save">Save</button></div>`;
    const ta = body.querySelector("textarea"); ta.value = cur; ta.focus();
    body.querySelector(".edit-cancel").onclick = () => loadThread(ticketId);
    body.querySelector(".edit-save").onclick = async () => {
      const v = ta.value.trim(); if (!v) return;
      try { await api(`/api/tickets/${ticketId}/comments/${cid}`, { method: "PUT", body: { body: v } });
        await Promise.all([loadThread(ticketId), loadActivity(ticketId)]); toast("Note updated"); }
      catch (e) { toast(e.message); }
    };
  }
  async function delComment(ticketId, cid) {
    if (!await axusConfirm("Delete this note?")) return;
    try { await api(`/api/tickets/${ticketId}/comments/${cid}`, { method: "DELETE" });
      await Promise.all([loadThread(ticketId), loadActivity(ticketId)]); toast("Note deleted"); }
    catch (e) { toast(e.message); }
  }

  async function loadTime(id) {
    const entries = await api(`/api/tickets/${id}/time`);
    const el = $("time-list");
    el.innerHTML = entries.length
      ? entries.map(e => `<div class="time-item"><span><span class="time-hours">${e.hours}h</span> ${esc(e.notes || "")}</span><span class="cell-muted">${esc(userMap[e.user_id] || "")}</span></div>`).join("")
      : `<div class="muted">No time logged.</div>`;
    // total hours worked on this ticket (staff-only)
    const total = Math.round(entries.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100;
    $("lt-total").textContent = total ? `· ${total} h total` : "";
  }

  async function loadAttachments(id) {
    const files = await api(`/api/tickets/${id}/attachments`);
    const box = $("attach-list");
    box.innerHTML = "";
    if (!files.length) { box.innerHTML = `<div class="muted">No files.</div>`; return; }
    files.forEach(f => {
      const row = document.createElement("div");
      row.className = "attach-item";
      row.innerHTML = `<span>📄</span><a href="#">${esc(f.filename)}</a><span class="attach-size">${fileSize(f.size)}</span>`;
      row.querySelector("a").onclick = ev => { ev.preventDefault(); download(f.id, f.filename); };
      box.appendChild(row);
    });
  }

  function actDotClass(a) {
    const d = (a.detail || "").toLowerCase();
    if (d.startsWith("internal note")) return "internal";       // blue
    if (d.includes("to closed")) return "closed";               // red
    if (a.action === "assigned_to_id_changed" || d.startsWith("assignee changed")) return "assigned";  // green
    return "";
  }

  async function loadActivity(id) {
    const acts = await api(`/api/tickets/${id}/activity`);
    $("activity").innerHTML = acts.slice().reverse().map(a => {
      const cls = actDotClass(a);
      return `
      <div class="act-item"><div class="act-dot${cls ? " " + cls : ""}"></div><div class="act-body">
        <div class="act-detail">${esc(a.detail || cap(a.action))}</div>
        <div class="act-time">${a.user_id ? esc(userMap[a.user_id] || "User") + " · " : ""}${fmtDate(a.created_at)}</div>
      </div></div>`;
    }).join("");
  }

  async function download(attId, filename, ticketId) {
    const res = await api(`/api/tickets/${ticketId || current.id}/attachments/${attId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Mutations ---------- */
  async function patch(field, value) {
    await api(`/api/tickets/${current.id}`, { method: "PUT", body: { [field]: value } });
    current[field] = value;
    await Promise.all([loadActivity(current.id), loadTickets()]); // refresh queue + audit
    if (field === "status") {
      current = await api(`/api/tickets/${current.id}`);
      $("d-status-badge").className = "badge " + current.status;
      $("d-status-badge").textContent = statusLabel(current.status);
      $("reopen-btn").hidden = current.status !== "closed";
      $("d-scheduled-date").value = schedInputVal(current.scheduled_date);
      toggleScheduled(current.status);
    }
    if (field === "priority") {
      $("d-prio-badge").className = "prio-badge " + value;
      $("d-prio-badge").textContent = prioLabel(value);
      $("d-prio-badge").title = PRIO_MEANING[value] || "";
    }
    // Friendly confirmation — spell out names/labels, not raw field keys.
    let msg;
    if (field === "assigned_to_id") msg = value ? `Assigned to ${userMap[value] || "user"}` : "Unassigned";
    else if (field === "board_id") msg = value ? `Moved to ${boardMap[value] || "board"}` : "Board cleared";
    else if (field === "priority") msg = `Priority set to ${prioLabel(value)}`;
    else if (field === "status") msg = `Status set to ${statusLabel(value)}`;
    else if (field === "origin") msg = "Origin updated";
    else msg = cap(field) + " updated";
    toast(msg);
  }
  // Update several fields in ONE request (used to move a ticket to Scheduled with its
  // date+time atomically, so the status never lands without a time).
  async function patchFields(fields) {
    await api(`/api/tickets/${current.id}`, { method: "PUT", body: fields });
    current = await api(`/api/tickets/${current.id}`);
    if ("status" in fields) {
      $("d-status").value = current.status;
      $("d-status-badge").className = "badge " + current.status;
      $("d-status-badge").textContent = statusLabel(current.status);
      $("reopen-btn").hidden = current.status !== "closed";
    }
    $("d-scheduled-date").value = schedInputVal(current.scheduled_date);
    toggleScheduled(current.status);
    await Promise.all([loadActivity(current.id), loadTickets()]);
    toast("Updated");
  }
  async function reopenTicket() {
    $("d-status").value = "open";
    try { await patch("status", "open"); } catch (e) { toast(e.message); }
  }
  /* ---------- Canned responses ---------- */
  async function loadCanned() {
    try { cannedData = await api("/api/canned/"); } catch (e) { cannedData = []; }
    fillCannedSelect();
  }
  function fillCannedSelect() {
    const sel = $("canned-select");
    if (!sel) return;
    sel.innerHTML = `<option value="">💬 Canned…</option>` +
      cannedData.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("") +
      `<option value="__manage__">⚙ Manage responses…</option>`;
  }
  function fillPlaceholders(text) {
    const t = current || {};
    const map = {
      "{{ref}}": t.reference || "",
      "{{title}}": t.title || "",
      "{{company}}": clientMap[t.client_id] || "",
      "{{name}}": ($("p-contact") && $("p-contact").textContent) || "there",
      "{{me}}": (me && me.full_name) || "",
    };
    return (text || "").replace(/\{\{(ref|title|company|name|me)\}\}/g, m => (m in map ? map[m] : m));
  }
  function insertCanned(body) {
    const ta = $("reply-body");
    const filled = fillPlaceholders(body);
    const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    ta.value = ta.value.slice(0, s) + filled + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + filled.length;
  }
  function openCannedModal() { $("canned-modal").classList.remove("hidden"); clearCannedForm(); renderCannedList(); }
  function clearCannedForm() { $("canned-id").value = ""; $("canned-title").value = ""; $("canned-body").value = ""; $("canned-error").textContent = ""; }
  function renderCannedList() {
    const box = $("canned-list");
    box.innerHTML = cannedData.length
      ? cannedData.map(c => `<div class="canned-item"><span class="canned-item-title">${esc(c.title)}</span>` +
          `<span class="canned-item-acts"><a data-edit="${c.id}">Edit</a><a data-del="${c.id}" class="canned-del">Delete</a></span></div>`).join("")
      : `<div class="muted">No canned responses yet. Add one below.</div>`;
    box.querySelectorAll("[data-edit]").forEach(a => a.onclick = () => {
      const c = cannedData.find(x => String(x.id) === a.dataset.edit); if (!c) return;
      $("canned-id").value = c.id; $("canned-title").value = c.title; $("canned-body").value = c.body; $("canned-title").focus();
    });
    box.querySelectorAll("[data-del]").forEach(a => a.onclick = async () => {
      if (!await axusConfirm("Delete this canned response?")) return;
      try { await api(`/api/canned/${a.dataset.del}`, { method: "DELETE" }); await loadCanned(); renderCannedList(); clearCannedForm(); toast("Deleted"); }
      catch (err) { toast(err.message); }
    });
  }
  async function postReply(bodyText, internal, files, close, withSig) {
    // Public replies (visible to the customer) get a sign-off: the staff member's
    // personal signature when "Include my signature" is on, otherwise "Axus Service Team".
    let body = bodyText || "";
    if (body && !internal) {
      body += (withSig && me.signature)
        ? "\n\n" + me.signature
        : "\n\nThank you for choosing our services.\nAxus Service Team";
    }
    // A single request posts the reply AND closes the case, so the close notice and
    // the final reply go out as one combined email.
    await api(`/api/tickets/${current.id}/comments`, {
      method: "POST", body: { body: body || null, is_internal: internal, close: !!close },
    });
    for (const f of (files || [])) {
      const fd = new FormData(); fd.append("file", f);
      try { await api(`/api/tickets/${current.id}/attachments`, { method: "POST", form: fd }); }
      catch (e) { toast(`Couldn't attach ${f.name}: ${e.message}`); }
    }
    // Refresh the conversation FIRST and on its own — a failure loading activity or
    // attachments must never stop the new reply from appearing.
    await loadThread(current.id);
    loadActivity(current.id).catch(() => {});
    loadAttachments(current.id).catch(() => {});
    if (close) await openTicket(current.id);   // refresh status/priority badges after closing
    toast(close ? "Case closed" : (internal ? "Internal note added" : "Reply posted"));
  }
  /* ---------- AI assist (staff only) ---------- */
  async function aiAssist(btn, endpoint, body, targetEl) {
    if (!btn || btn.disabled) return;
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "✨ Thinking…";
    try {
      const r = await api("/api/ai/" + endpoint, { method: "POST", body });
      if (r && r.result) {
        targetEl.value = r.result;
        targetEl.style.height = "";
        targetEl.focus();
        toast("AI draft ready — review and edit before sending");
      }
    } catch (e) { toast("AI: " + (e.message || "request failed")); }
    finally { btn.disabled = false; btn.textContent = orig; }
  }

  /* ---------- Ask AI Assistant: chat helper for the New Ticket description ---------- */
  let askMessages = [];          // {role:'user'|'assistant', content}
  let askLastDraft = "";         // most recent AI reply — what "Use this description" inserts
  function renderAskLog() {
    const box = $("ai-ask-log");
    if (!askMessages.length) {
      box.innerHTML = '<div class="ai-ask-msg note">Ask a question to get started — e.g. “draft a description for this issue”.</div>';
      return;
    }
    box.innerHTML = askMessages.map(m =>
      `<div class="ai-ask-msg ${m.role === "assistant" ? "ai" : "user"}">${esc(m.content)}</div>`).join("");
    box.scrollTop = box.scrollHeight;
  }
  function openAskAssistant() {
    askMessages = []; askLastDraft = "";
    $("ai-ask-accept").disabled = true;
    $("ai-ask-text").value = "";
    renderAskLog();
    $("ai-ask-modal").classList.remove("hidden");
    $("ai-ask-text").focus();
  }
  function closeAskAssistant() { $("ai-ask-modal").classList.add("hidden"); }
  async function sendAskMessage() {
    const inp = $("ai-ask-text");
    const text = inp.value.trim();
    if (!text) return;
    const sendBtn = $("ai-ask-send");
    if (sendBtn.disabled) return;
    askMessages.push({ role: "user", content: text });
    inp.value = ""; renderAskLog();
    const orig = sendBtn.textContent;
    sendBtn.disabled = true; sendBtn.textContent = "Thinking…";
    try {
      const r = await api("/api/ai/ask", {
        method: "POST",
        body: { messages: askMessages, description: $("nt-desc").value.trim() || null },
      });
      if (r && r.result) {
        askMessages.push({ role: "assistant", content: r.result });
        askLastDraft = r.result;
        $("ai-ask-accept").disabled = false;
        renderAskLog();
      }
    } catch (e) {
      askMessages.pop();   // drop the unanswered question so the log stays consistent
      renderAskLog();
      toast("AI: " + (e.message || "request failed"));
    } finally { sendBtn.disabled = false; sendBtn.textContent = orig; }
  }
  function wireAskAssistant() {
    $("ai-ask-desc").onclick = openAskAssistant;
    $("ai-ask-close").onclick = closeAskAssistant;
    $("ai-ask-cancel").onclick = closeAskAssistant;
    $("ai-ask-form").onsubmit = e => { e.preventDefault(); sendAskMessage(); };
    // Enter sends, Shift+Enter makes a newline.
    $("ai-ask-text").onkeydown = e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAskMessage(); }
    };
    $("ai-ask-accept").onclick = () => {
      if (!askLastDraft) return;
      const box = $("nt-desc");
      const existing = box.value.trim();
      // Append — never replace what's already in the Description box.
      box.value = existing ? existing + "\n\n" + askLastDraft : askLastDraft;
      box.style.height = "";
      askLastDraft = "";                       // consumed — don't add the same draft twice
      $("ai-ask-accept").disabled = true;      // re-enabled when the next AI reply arrives
      toast("Added to description — keep asking or close when done");
    };
  }

  /* ---------- Glossary (staff-only reference) ---------- */
  let glossaryData = [];
  async function loadGlossary() {
    try { glossaryData = await api("/api/glossary/"); } catch (e) { glossaryData = []; }
    renderGlossary();
  }
  function renderGlossary() {
    const q = ($("gl-search").value || "").toLowerCase();
    const rows = glossaryData.filter(t =>
      !q || t.term.toLowerCase().includes(q) || (t.definition || "").toLowerCase().includes(q));
    const box = $("glossary-list");
    $("glossary-empty").classList.toggle("hidden", glossaryData.length > 0);
    box.innerHTML = rows.map(t => `
      <div class="gl-item">
        <div class="gl-item-main">
          <div class="gl-term">${esc(t.term)}</div>
          <div class="gl-def">${esc(t.definition)}</div>
        </div>
        <div class="gl-acts"><a data-edit="${t.id}">Edit</a><a data-del="${t.id}" class="gl-del">Delete</a></div>
      </div>`).join("");
    box.querySelectorAll("[data-edit]").forEach(a => a.onclick = () => {
      const t = glossaryData.find(x => String(x.id) === a.dataset.edit); if (t) openGlossaryModal(t);
    });
    box.querySelectorAll("[data-del]").forEach(a => a.onclick = async () => {
      if (!await axusConfirm("Delete this glossary term?")) return;
      try { await api(`/api/glossary/${a.dataset.del}`, { method: "DELETE" }); await loadGlossary(); toast("Deleted"); }
      catch (err) { toast(err.message); }
    });
  }
  function openGlossaryModal(t) {
    $("gl-id").value = t ? t.id : "";
    $("gl-term").value = t ? t.term : "";
    $("gl-def").value = t ? t.definition : "";
    $("gl-error").textContent = "";
    $("gl-modal-title").textContent = t ? "Edit term" : "Add term";
    $("gl-modal").classList.remove("hidden");
    $("gl-term").focus();
  }
  function closeGlossaryModal() { $("gl-modal").classList.add("hidden"); }
  async function saveGlossary() {
    const id = $("gl-id").value;
    const term = $("gl-term").value.trim();
    const definition = $("gl-def").value.trim();
    if (!term || !definition) { $("gl-error").textContent = "Term and definition are required."; return; }
    const path = id ? `/api/glossary/${id}` : "/api/glossary/";
    await api(path, { method: id ? "PUT" : "POST", body: { term, definition } });
    closeGlossaryModal(); await loadGlossary(); toast("Saved");
  }

  /* ---------- Signature ---------- */
  let sigLogo = null;  // pending logo data URL while the modal is open ("" = cleared)

  // Resize an uploaded image to a signature-appropriate size (max 64px tall / 240px wide),
  // keeping aspect ratio. SVGs are kept as-is (vector, already scalable).
  function resizeLogo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.onload = () => {
        const src = reader.result;
        if (file.type === "image/svg+xml") { resolve(src); return; }
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image"));
        img.onload = () => {
          const MAX_H = 64, MAX_W = 240;
          let { width: w, height: h } = img;
          const scale = Math.min(MAX_W / w, MAX_H / h, 1);
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          // PNG preserves transparency; keeps logos clean on any background
          resolve(cv.toDataURL("image/png"));
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderSigLogo() {
    const cur = sigLogo === null ? (me.signature_logo || "") : sigLogo;
    const prev = $("sig-logo-preview");
    if (cur) {
      prev.innerHTML = `<img src="${cur}" alt="Logo" />`;
      $("sig-logo-remove").classList.remove("hidden");
    } else {
      prev.innerHTML = `<span class="sig-logo-empty">No logo</span>`;
      $("sig-logo-remove").classList.add("hidden");
    }
  }

  function openSignature() {
    $("sig-text").value = me.signature || "";
    sigLogo = null;            // null = "unchanged from saved"
    renderSigLogo();
    $("sig-modal").classList.remove("hidden");
  }

  async function onLogoPicked(file) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast("Image too large (max 3 MB)"); return; }
    try {
      sigLogo = await resizeLogo(file);
      renderSigLogo();
    } catch (e) { toast(e.message); }
  }

  async function saveSignature() {
    const body = { signature: $("sig-text").value };
    if (sigLogo !== null) body.signature_logo = sigLogo;  // only send when changed
    try {
      const u = await api("/api/auth/signature", { method: "PUT", body });
      me.signature = u.signature || "";
      me.signature_logo = u.signature_logo || "";
      $("sig-modal").classList.add("hidden"); toast("Signature saved");
    } catch (e) { toast(e.message); }
  }
  async function logTime(hours, notes) {
    await api(`/api/tickets/${current.id}/time`, { method: "POST", body: { hours, notes: notes || null } });
    current = await api(`/api/tickets/${current.id}`);
    $("p-hours").textContent = (current.total_hours || 0) + " h";
    $("p-type").textContent = current.ticket_type === "sow" ? "SOW / Project" : "Standard";
    await Promise.all([loadTime(current.id), loadActivity(current.id), loadTickets()]);
    toast("Time logged");
  }
  async function uploadFile(file) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/tickets/${current.id}/attachments`, { method: "POST", form: fd });
    await Promise.all([loadAttachments(current.id), loadActivity(current.id)]);
    toast("File uploaded");
  }
  async function promoteXcitium() {
    if (!current || current.source !== "xcitium") return;
    const ext = -current.id;
    if (!await axusConfirm("Import this Xcitium ticket into Axus so you can edit it?\n\nThe imported copy becomes a normal editable ticket, and the hourly sync will no longer overwrite it.")) return;
    try {
      const r = await api(`/api/xcitium/tickets/${ext}/promote`, { method: "POST" });
      toast("Imported — now editable");
      await loadTickets();
      await openTicket(r.id);
    } catch (err) { toast(err.message); }
  }
  async function deleteTicket() {
    const ref = current.reference || "this ticket";
    if (!await axusConfirm(`Permanently delete ${ref}?\n\nThis removes the ticket and all of its replies, notes, time entries, and attachments. This cannot be undone.`)) return;
    try {
      await api(`/api/tickets/${current.id}`, { method: "DELETE" });
      toast(`Deleted ${ref}`);
      showQueue(); await loadTickets();
    } catch (err) { toast(err.message); }
  }
  async function createTicket(payload, files) {
    const t = await api("/api/tickets/", { method: "POST", body: payload });
    for (const f of (files || [])) {
      const fd = new FormData(); fd.append("file", f);
      try { await api(`/api/tickets/${t.id}/attachments`, { method: "POST", form: fd }); }
      catch (e) { toast(`Couldn't attach ${f.name}: ${e.message}`); }
    }
    closeNew(); await loadTickets(); openTicket(t.id);
    toast((t.reference || "Ticket") + " created");
  }

  /* ---------- Customers ---------- */
  let custEditId = null;

  async function refreshClients() {
    clientsData = await api("/api/clients/");
    clientMap = {}; clientsData.forEach(c => clientMap[c.id] = c.company_name);
    $("c-customers").textContent = clientsData.length;
    fillClientSelects();   // keep the business dropdowns current (new business shows up)
  }

  // ---- Column sorting (Business + Users tables) ----
  let custSort = { key: "name", dir: 1 };
  let userSort = { key: "name", dir: 1 };
  let queueSort = { key: "updated", dir: -1 };   // default: newest updated first
  function cmpVals(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }
  function bindSort(tableId, state, renderFn) {
    const table = $(tableId);
    if (!table) return;
    table.querySelectorAll("thead th.sortable").forEach(th => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (state.key === key) state.dir *= -1; else { state.key = key; state.dir = 1; }
        renderFn();
        markSort(tableId, state);
      };
    });
    markSort(tableId, state);
  }
  function markSort(tableId, state) {
    const table = $(tableId);
    if (!table) return;
    table.querySelectorAll("thead th.sortable").forEach(th => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.key) th.classList.add(state.dir === 1 ? "sorted-asc" : "sorted-desc");
    });
  }

  function custVal(c, key) {
    switch (key) {
      case "name": return c.company_name || "";
      case "location": return c.location || "";
      case "phone": return c.phone || "";
      case "website": return c.website || "";
      case "tickets": return tickets.filter(t => t.client_id === c.id
        || (t.source === "xcitium" && (t.client_name || "") === c.company_name)).length;
      case "added": return c.created_at ? new Date(c.created_at).getTime() : 0;
      default: return "";
    }
  }
  function renderCustomers() {
    const q = ($("cust-search").value || "").toLowerCase();
    const rows = clientsData
      .filter(c => !q || `${c.company_name} ${c.location || ""} ${c.website || ""}`.toLowerCase().includes(q))
      .sort((a, b) => custSort.dir * cmpVals(custVal(a, custSort.key), custVal(b, custSort.key)));
    $("cust-summary").textContent = `${clientsData.length} business${clientsData.length === 1 ? "" : "es"}`;
    const tbody = $("customer-rows"); tbody.innerHTML = "";
    $("customers-empty").classList.toggle("hidden", rows.length > 0);
    for (const c of rows) {
      const tcount = tickets.filter(t => t.client_id === c.id
        || (t.source === "xcitium" && (t.client_name || "") === c.company_name)).length;
      const tr = document.createElement("tr");
      tr.onclick = () => openCustomer(c.id);
      tr.innerHTML = `
        <td class="cell-subject col-name">${esc(c.company_name)}</td>
        <td class="cell-muted col-location">${esc(c.location || "—")}</td>
        <td class="cell-muted col-phone">${esc(c.phone || "—")}${c.ext ? " x" + esc(c.ext) : ""}</td>
        <td class="cell-muted col-website">${esc(c.website || "—")}</td>
        <td class="col-tickets">${tcount}</td>
        <td class="cell-muted col-added">${c.created_at ? fmtDate(c.created_at) : "—"}</td>`;
      tbody.appendChild(tr);
    }
    applyBizCols();
  }

  async function openCustomer(id) {
    currentCustomer = await api(`/api/clients/${id}`);
    const c = currentCustomer;
    $("cd-name").textContent = c.company_name;
    $("cd-status").className = "badge " + (c.is_active ? "resolved" : "closed");
    $("cd-status").textContent = c.is_active ? "Active" : "Inactive";
    $("cd-location").textContent = c.location || "—";
    $("cd-phone").textContent = c.phone || "—";
    $("cd-ext").textContent = c.ext || "—";
    if (c.website) {
      const url = /^https?:\/\//i.test(c.website) ? c.website : "https://" + c.website;
      $("cd-website").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--orange)">${esc(c.website)}</a>`;
    } else { $("cd-website").textContent = "—"; }
    $("cd-notes").textContent = c.notes || "—";
    $("cd-since").textContent = c.created_at ? fmtDate(c.created_at) : "—";
    // recent tickets for this customer (from already-loaded set)
    const theirs = tickets.filter(t => t.client_id === id)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 8);
    const box = $("cd-tickets"); box.innerHTML = "";
    if (!theirs.length) box.innerHTML = `<div class="muted">No tickets yet.</div>`;
    theirs.forEach(t => {
      const row = document.createElement("div");
      row.className = "time-item"; row.style.cursor = "pointer";
      row.innerHTML = `<span><span class="time-hours">${esc(t.reference || "")}</span> ${esc(t.title)}</span><span class="badge ${t.status}">${cap(t.status)}</span>`;
      row.onclick = () => openTicket(t.id);
      box.appendChild(row);
    });
    // Business-level password-login toggle (all-or-nothing).
    $("cd-biz-pw").checked = !!c.password_login_enabled;
    showCustomerDetail();
    const users = await api(`/api/clients/${id}/portal-users`);
    renderCustomerUsers(users, !!c.password_login_enabled);
  }

  // Render the business's users with per-user password-login controls.
  function renderCustomerUsers(users, bizOn) {
    const box = $("cd-users");
    if (!users.length) { box.innerHTML = `<div class="muted">No users yet.</div>`; return; }
    box.innerHTML = users.map(u => {
      const active = bizOn || u.password_login_enabled;
      const state = bizOn
        ? `<span class="badge open" title="Enabled for the whole business" style="white-space:nowrap">Via business</span>`
        : (u.password_login_enabled
            ? `<span class="badge resolved">On</span>`
            : `<span class="badge closed">Off</span>`);
      const setLbl = u.has_password ? "Reset password" : "Set password";
      const pending = u.must_change_password ? ` <span class="cell-muted" title="Must change at next sign-in">(temp — must change)</span>` : "";
      // Per-user toggle is only editable when the business toggle is OFF.
      const perUser = bizOn
        ? `<label class="cell-muted" style="font-size:12px;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" checked disabled> Enabled via business</label>`
        : `<label style="font-size:12px;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" data-user-pw="${u.id}" ${u.password_login_enabled ? "checked" : ""}> Password login</label>`;
      return `<div class="time-item" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap">
          <span style="min-width:0;flex:1">${esc(u.full_name)}<br><span class="cell-muted">${esc(u.email)}</span>${pending}</span>
          <span class="cell-muted" style="font-size:11px;display:inline-flex;align-items:center;gap:4px;flex-shrink:0">Password ${state}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          ${perUser}
          <button class="btn btn-ghost btn-xs" data-set-pw="${u.id}" data-set-name="${esc(u.full_name)}" ${active ? "" : "disabled title='Enable password login first'"}>${setLbl}</button>
        </div>
      </div>`;
    }).join("");
    // wire per-user enable toggles
    box.querySelectorAll("[data-user-pw]").forEach(cb => {
      cb.onchange = async () => {
        const uid = cb.getAttribute("data-user-pw");
        try {
          await api(`/api/clients/${currentCustomer.id}/portal-users/${uid}/password-login`,
                    { method: "PUT", body: { enabled: cb.checked } });
          await openCustomer(currentCustomer.id);
          toast(cb.checked ? "Password login enabled" : "Password login disabled");
        } catch (err) { toast(err.message); cb.checked = !cb.checked; }
      };
    });
    // wire set/reset password buttons
    box.querySelectorAll("[data-set-pw]").forEach(btn => {
      btn.onclick = () => openSetPwModal(btn.getAttribute("data-set-pw"), btn.getAttribute("data-set-name"));
    });
  }

  /* ---------- Set / reset a portal user's password ---------- */
  let setPwUserId = null;
  function genTempPassword() {
    const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz",
          N = "23456789", S = "!@#$%^&*?";
    const all = U + L + N + S, pick = s => s[Math.floor(Math.random() * s.length)];
    let out = [pick(U), pick(L), pick(N), pick(S)];
    for (let i = 0; i < 8; i++) out.push(pick(all));
    return out.sort(() => Math.random() - 0.5).join("");
  }
  function openSetPwModal(userId, name) {
    setPwUserId = userId;
    $("setpw-modal-title").textContent = "Set / reset password";
    $("setpw-modal-sub").textContent = `Temporary password for ${name}. They'll be forced to choose a new one at their next sign-in.`;
    $("spw-value").value = ""; $("spw-error").textContent = "";
    $("setpw-modal").classList.remove("hidden");
    $("spw-value").focus();
  }

  function showCustModal(c) {
    $("cf-error").textContent = "";
    if (c) {
      $("cust-modal-title").textContent = "Edit Business";
      $("cf-company").value = c.company_name;
      $("cf-location").value = c.location || "";
      $("cf-phone").value = c.phone || ""; $("cf-ext").value = c.ext || "";
      $("cf-website").value = c.website || "";
      $("cf-notes").value = c.notes || "";
      custEditId = c.id;
    } else {
      $("cust-modal-title").textContent = "New Business";
      $("cust-form").reset(); custEditId = null;
    }
    $("cust-modal").classList.remove("hidden");
  }
  const closeCustModal = () => $("cust-modal").classList.add("hidden");

  async function saveCustomer() {
    const payload = {
      company_name: $("cf-company").value.trim(),
      location: $("cf-location").value.trim() || null,
      phone: $("cf-phone").value.trim() || null,
      ext: $("cf-ext").value.trim() || null,
      website: $("cf-website").value.trim() || null,
      notes: $("cf-notes").value.trim() || null,
      is_active: true,
    };
    if (custEditId) await api(`/api/clients/${custEditId}`, { method: "PUT", body: payload });
    else await api("/api/clients/", { method: "POST", body: payload });
    closeCustModal();
    await refreshClients();
    renderCustomers();
    if (custEditId && currentCustomer && currentCustomer.id === custEditId) await openCustomer(custEditId);
    toast("Business saved");
  }

  async function addPortalUser() {
    await api(`/api/clients/${currentCustomer.id}/portal-users`, {
      method: "POST",
      body: { full_name: $("pu-name").value.trim(), email: $("pu-email").value.trim() },
    });
    $("puser-modal").classList.add("hidden"); $("pu-form").reset();
    await openCustomer(currentCustomer.id);
    toast("User created");
  }

  /* ---------- Users ---------- */
  let userEditId = null;
  const roleBadge = { admin: "waiting", technician: "open", client: "in_progress" };

  async function refreshUsers() {
    const inc = $("show-hidden") && $("show-hidden").checked ? "?include_hidden=true" : "";
    usersData = await api("/api/users/" + inc);
    userMap = {}; usersData.forEach(u => userMap[u.id] = u.full_name);
    staffUsers = usersData.filter(u => u.role !== "client");
    $("c-users").textContent = usersData.filter(u => !u.hidden).length;
  }

  function userVal(u, key) {
    switch (key) {
      case "name": return u.full_name || "";
      case "email": return u.email || "";
      case "phone": return u.phone || "";
      case "role": return u.role || "";
      case "business": return u.client_id ? (clientMap[u.client_id] || "") : "";
      case "tickets": return u.assigned_tickets || 0;
      case "status": return u.is_active ? 1 : 0;
      default: return "";
    }
  }
  function renderUsers() {
    const q = ($("user-search").value || "").toLowerCase();
    const fr = $("uf-role").value;
    const roleMatch = u => !fr ? true
      : fr === "staff" ? (u.role === "admin" || u.role === "technician")
      : u.role === fr;
    const rows = usersData
      .filter(roleMatch)
      .filter(u => !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => userSort.dir * cmpVals(userVal(a, userSort.key), userVal(b, userSort.key)));
    const label = fr === "staff" ? "staff" : fr ? fr : "user";
    $("users-summary").textContent =
      `${rows.length} ${label}${rows.length === 1 ? "" : "s"} · ${usersData.length} total`;
    const tbody = $("user-rows"); tbody.innerHTML = "";
    $("users-empty").classList.toggle("hidden", rows.length > 0);
    for (const u of rows) {
      const tr = document.createElement("tr");
      if (u.hidden) tr.classList.add("row-hidden");
      tr.onclick = () => showUserModal(u);
      const actions = u.id === me.id
        ? `<span class="cell-muted">—</span>`
        : `${u.hidden
              ? `<button class="btn btn-ghost btn-xs" data-unhide-user="${u.id}">Unhide</button>`
              : `<button class="btn btn-ghost btn-xs" data-hide-user="${u.id}" title="Move to the hidden holding business">Hide</button>`}` +
          `<button class="btn btn-ghost btn-xs btn-danger" data-del-user="${u.id}" data-del-name="${esc(u.full_name)}">Delete</button>`;
      tr.innerHTML = `
        <td class="cell-subject col-name">${esc(u.full_name)}${u.hidden ? ' <span class="badge closed">Hidden</span>' : ""}</td>
        <td class="cell-muted col-email">${esc(u.email)}</td>
        <td class="cell-muted col-phone">${esc(u.phone || "—")}</td>
        <td class="col-role"><span class="badge ${roleBadge[u.role] || "closed"}">${cap(u.role)}</span></td>
        <td class="cell-muted col-business">${u.client_id ? esc(clientMap[u.client_id] || "—") : "—"}</td>
        <td class="cell-muted col-tickets">${u.assigned_tickets || 0}</td>
        <td class="col-status"><span class="badge ${u.is_active ? "resolved" : "closed"}">${u.is_active ? "Active" : "Inactive"}</span></td>
        <td class="user-actions col-actions">${actions}</td>`;
      const hideBtn = tr.querySelector("[data-hide-user]");
      if (hideBtn) hideBtn.onclick = async (e) => {
        e.stopPropagation();
        try { await api(`/api/users/${hideBtn.dataset.hideUser}/hide`, { method: "POST" });
          toast("User hidden"); await refreshUsers(); renderUsers(); }
        catch (err) { toast(err.message); }
      };
      const unhideBtn = tr.querySelector("[data-unhide-user]");
      if (unhideBtn) unhideBtn.onclick = async (e) => {
        e.stopPropagation();
        try { await api(`/api/users/${unhideBtn.dataset.unhideUser}/unhide`, { method: "POST" });
          toast("User unhidden"); await refreshUsers(); renderUsers(); }
        catch (err) { toast(err.message); }
      };
      const del = tr.querySelector("[data-del-user]");
      if (del) del.onclick = async (e) => {
        e.stopPropagation();
        if (!await axusConfirm(`Delete ${del.dataset.delName}?\n\nThey will not be re-created when Xcitium syncs.`)) return;
        try {
          const r = await api(`/api/users/${del.dataset.delUser}`, { method: "DELETE" });
          toast("User deleted"); await refreshUsers(); renderUsers();
        } catch (err) {
          if (err.status === 409) openXferModal(parseInt(del.dataset.delUser), del.dataset.delName);
          else toast(err.message);
        }
      };
      tbody.appendChild(tr);
    }
    applyUsrCols();
  }

  let xferUserId = null;
  function openXferModal(userId, userName) {
    xferUserId = userId;
    $("xfer-msg").textContent = `${userName} has ticket history. Choose an active user to receive it — then this user is deleted.`;
    const opts = usersData
      .filter(u => u.is_active && u.id !== userId)
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(u => `<option value="${u.id}">${esc(u.full_name)} · ${esc(cap(u.role))}</option>`).join("");
    $("xfer-select").innerHTML = opts || `<option value="">No other active users</option>`;
    $("xfer-error").textContent = "";
    $("xfer-modal").classList.remove("hidden");
  }

  function showUserModal(u) {
    $("uf-error").textContent = "";
    if (u) {
      $("user-modal-title").textContent = "Edit User";
      $("uf-name").value = u.full_name; $("uf-email").value = u.email;
      $("uf-phone").value = u.phone || ""; $("uf-roleSel").value = u.role;
      $("uf-active").value = String(u.is_active); $("uf-client").value = u.client_id || "";
      userEditId = u.id;
    } else {
      $("user-modal-title").textContent = "New User";
      $("user-form").reset(); userEditId = null;
    }
    $("user-modal").classList.remove("hidden");
  }
  const closeUserModal = () => $("user-modal").classList.add("hidden");

  async function saveUser() {
    const clientVal = $("uf-client").value;
    const base = {
      full_name: $("uf-name").value.trim(),
      email: $("uf-email").value.trim(),
      phone: $("uf-phone").value.trim() || null,
      role: $("uf-roleSel").value,
      client_id: clientVal ? parseInt(clientVal) : null,
    };
    if (userEditId) {
      await api(`/api/users/${userEditId}`, { method: "PUT", body: { ...base, is_active: $("uf-active").value === "true" } });
    } else {
      await api("/api/users/", { method: "POST", body: base });
    }
    closeUserModal();
    await Promise.all([refreshUsers(), refreshClients(), loadCanned()]);
    renderUsers();
    toast("User saved");
  }

  /* ---------- New / Edit ticket modal ---------- */
  let ticketEditId = null;
  let ntPreset = null;  // {client_id, project_id} applied on the next showNew()
  const showNew = () => {
    ticketEditId = null;
    $("nt-submit").textContent = "Create ticket";
    $("new-form").reset();
    $("nt-file-list").innerHTML = ""; $("nt-desc").style.height = "";   // clear staged files + reset description height
    $("nt-error").textContent = "";
    loadProjectsInto($("nt-project"), null);
    // A project can't be chosen when creating a normal ticket — child (C-) tickets are
    // only created from within a project. So the Project field is hidden on create.
    $("nt-project-wrap").style.display = "none";
    if (ntPreset && ntPreset.project_id) {
      // "New ticket in this project" — project + business are inherited from the project,
      // not user-selectable here (a child belongs to the same business as its project).
      $("nt-client").value = String(ntPreset.client_id);
      $("nt-client-wrap").style.display = "none";
      $("nt-project").value = String(ntPreset.project_id);
      const p = tickets.find(t => t.id === ntPreset.project_id);
      const biz = clientMap[ntPreset.client_id] || "";
      $("nt-modal-title").textContent = "New Ticket in " + (p ? (p.reference || "Project") : "Project") + (biz ? " · " + biz : "");
    } else {
      $("nt-client-wrap").style.display = "";
      $("nt-modal-title").textContent = "New Ticket";
    }
    ntPreset = null;
    $("new-modal").classList.remove("hidden");
    // load the Users for whichever Business is currently selected (onchange won't fire on open)
    loadUsersInto($("nt-contact"), $("nt-client").value);
    $("nt-title").focus();
  };
  function newTicketInProject() {
    ntPreset = { client_id: current.client_id, project_id: current.id };
    showNew();
  }
  async function showEditTicket() {
    if (!current) return;
    const t = current;
    ticketEditId = t.id;
    $("nt-modal-title").textContent = "Edit Ticket";
    $("nt-submit").textContent = "Save changes";
    $("nt-error").textContent = "";
    $("nt-title").value = t.title || "";
    $("nt-client-wrap").style.display = "";     // business is editable on an existing ticket
    $("nt-client").value = String(t.client_id);
    $("nt-board").value = t.board_id ? String(t.board_id) : "";
    $("nt-project-wrap").style.display = "";    // existing tickets can be linked to a project
    loadProjectsInto($("nt-project"), t.id);    // a ticket can't be its own project
    $("nt-project").value = t.project_id ? String(t.project_id) : "";
    $("nt-desc").value = t.description || "";
    $("nt-category").value = t.category || "";
    $("nt-priority").value = t.priority;
    $("nt-assignee").value = t.assigned_to_id ? String(t.assigned_to_id) : "";
    $("nt-origin").value = t.origin || "axus_tech";
    $("nt-address").value = t.contact_address || "";
    $("nt-phone").value = t.contact_phone || "";
    $("nt-po").value = t.po_number || "";
    $("new-modal").classList.remove("hidden");
    // load the business's users, then select the current reporter
    await loadUsersInto($("nt-contact"), String(t.client_id));
    $("nt-contact").value = t.reporter_user_id ? String(t.reporter_user_id) : "";
  }
  const closeNew = () => { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-file-list").innerHTML = ""; $("nt-error").textContent = ""; ticketEditId = null; };

  async function loadUsersInto(selectEl, clientId) {
    selectEl.innerHTML = `<option value="">— None —</option>`;
    if (!clientId) return;
    try {
      const users = await api(`/api/clients/${clientId}/portal-users`);
      users.forEach(u => {
        const o = document.createElement("option");
        o.value = u.id; o.textContent = u.full_name + (u.email ? ` (${u.email})` : "");
        selectEl.appendChild(o);
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------- Wiring ---------- */
  async function start() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    $("theme-toggle-login").onclick = toggleTheme;

    $("login-form").onsubmit = async e => {
      e.preventDefault(); $("login-error").textContent = "";
      $("login-btn").disabled = true; $("login-btn").textContent = "Signing in…";
      try { await login($("login-email").value.trim(), $("login-password").value); await enter(); }
      catch (err) { $("login-error").textContent = err.message; }
      finally { $("login-btn").disabled = false; $("login-btn").textContent = "Sign in"; }
    };
    // SSO button (central mode): re-hitting /staff sends the browser back through
    // Traefik's Authentik forward-auth, which redirects to single sign-on.
    $("sso-btn").onclick = () => { location.reload(); };
    $("logout-btn").onclick = logout;
    // Collapsible sidebar sections (click a header to expand / collapse; state remembered)
    const COLLAPSE_KEY = "axus-staff-collapsed-groups";
    let collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
    document.querySelectorAll(".nav-group").forEach(g => {
      const key = g.dataset.group;
      if (collapsed.has(key)) g.classList.add("collapsed");
      g.querySelector(".side-label").onclick = () => {
        g.classList.toggle("collapsed");
        if (g.classList.contains("collapsed")) collapsed.add(key); else collapsed.delete(key);
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      };
    });
    // Profile dropdown
    const profileMenu = $("profile-menu"), profileBtn = $("profile-btn");
    const closeProfile = () => { profileMenu.classList.add("hidden"); profileBtn.setAttribute("aria-expanded", "false"); };
    profileBtn.onclick = e => {
      e.stopPropagation();
      const open = profileMenu.classList.toggle("hidden");
      profileBtn.setAttribute("aria-expanded", open ? "false" : "true");
    };
    document.addEventListener("click", e => { if (!$("profile").contains(e.target)) closeProfile(); });
    // Signature (opened from the profile menu)
    $("sig-btn").onclick = () => { closeProfile(); openSignature(); };
    $("xnum-btn").onclick = () => { closeProfile(); $("xnum-file").click(); };
    $("xnum-file").onchange = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      const fd = new FormData(); fd.append("file", f);
      toast("Importing Xcitium ticket numbers…");
      try {
        const r = await api("/api/xcitium/ticket-numbers", { method: "POST", form: fd });
        await loadTickets();
        const un = (r.unmatched || []).length;
        toast(`Xcitium #s: ${r.updated} updated, ${r.matched} matched` + (un ? `, ${un} not in mirror` : ""));
      } catch (err) { toast(err.message); }
    };
    $("sig-close").onclick = () => $("sig-modal").classList.add("hidden");
    $("sig-cancel").onclick = () => $("sig-modal").classList.add("hidden");
    $("sig-save").onclick = saveSignature;
    $("sig-logo-pick").onclick = () => $("sig-logo-file").click();
    $("sig-logo-file").onchange = e => { onLogoPicked(e.target.files[0]); e.target.value = ""; };
    $("sig-logo-remove").onclick = () => { sigLogo = ""; renderSigLogo(); };
    $("new-ticket-btn").onclick = showNew;
    $("edit-ticket-btn").onclick = () => showEditTicket();
    $("convert-project-btn").onclick = convertToProject;
    $("delete-ticket-btn").onclick = deleteTicket;
    $("promote-btn").onclick = promoteXcitium;
    $("reopen-btn").onclick = reopenTicket;
    $("pt-add-btn").onclick = newTicketInProject;
    $("modal-close").onclick = closeNew; $("nt-cancel").onclick = closeNew;
    $("back-btn").onclick = () => { showQueue(); };

    // customers
    $("cust-search").oninput = renderCustomers;
    bindSort("customer-table", custSort, renderCustomers);
    $("new-customer-btn").onclick = () => { $("business-dd-menu").classList.add("hidden"); showCustModal(null); };
    $("cust-modal-close").onclick = closeCustModal; $("cf-cancel").onclick = closeCustModal;
    $("cust-back-btn").onclick = () => { showCustomers(); renderCustomers(); };
    $("cd-edit-btn").onclick = () => showCustModal(currentCustomer);
    $("cust-form").onsubmit = async e => { e.preventDefault(); $("cf-error").textContent = ""; try { await saveCustomer(); } catch (err) { $("cf-error").textContent = err.message; } };
    $("cd-adduser-btn").onclick = () => { $("pu-error").textContent = ""; $("pu-form").reset(); $("puser-modal").classList.remove("hidden"); };
    $("pu-close").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-cancel").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-form").onsubmit = async e => { e.preventDefault(); $("pu-error").textContent = ""; try { await addPortalUser(); } catch (err) { $("pu-error").textContent = err.message; } };

    // Business-level password-login toggle (all-or-nothing).
    $("cd-biz-pw").onchange = async () => {
      const on = $("cd-biz-pw").checked;
      try {
        await api(`/api/clients/${currentCustomer.id}/password-login`,
                  { method: "PUT", body: { enabled: on } });
        await openCustomer(currentCustomer.id);
        toast(on ? "Password login enabled for all users" : "Business password login disabled");
      } catch (err) { toast(err.message); $("cd-biz-pw").checked = !on; }
    };

    // Set / reset a portal user's temporary password.
    $("setpw-modal-close").onclick = () => $("setpw-modal").classList.add("hidden");
    $("spw-cancel").onclick = () => $("setpw-modal").classList.add("hidden");
    $("spw-gen").onclick = () => { $("spw-value").value = genTempPassword(); $("spw-value").focus(); };
    $("setpw-modal-form").onsubmit = async e => {
      e.preventDefault(); $("spw-error").textContent = "";
      const pw = $("spw-value").value.trim();
      if (pw.length < 8) { $("spw-error").textContent = "Password must be at least 8 characters."; return; }
      $("spw-save").disabled = true;
      try {
        await api(`/api/clients/${currentCustomer.id}/portal-users/${setPwUserId}/password`,
                  { method: "PUT", body: { password: pw } });
        $("setpw-modal").classList.add("hidden");
        await openCustomer(currentCustomer.id);
        toast("Password set — user must change it at next sign-in");
      } catch (err) { $("spw-error").textContent = err.message; }
      finally { $("spw-save").disabled = false; }
    };

    // ticket form: load users when business changes
    $("nt-client").onchange = () => loadUsersInto($("nt-contact"), $("nt-client").value);
    // New Ticket attachments: same dashed drop-box + staged chips as the reply/portal.
    $("nt-files").onchange = renderNtFiles;
    wireDropzone($("nt-upload-box"), files => { addFilesToInput($("nt-files"), files); renderNtFiles(); });

    // transfer-and-delete modal
    $("xfer-close").onclick = () => $("xfer-modal").classList.add("hidden");
    $("xfer-cancel").onclick = () => $("xfer-modal").classList.add("hidden");
    $("xfer-confirm").onclick = async () => {
      const target = $("xfer-select").value;
      if (!target) { $("xfer-error").textContent = "Pick a user to transfer to."; return; }
      try {
        const r = await api(`/api/users/${xferUserId}?transfer_to=${target}`, { method: "DELETE" });
        $("xfer-modal").classList.add("hidden");
        toast(`Transferred ${r.transferred} item${r.transferred === 1 ? "" : "s"} and deleted the user`);
        await refreshUsers(); renderUsers();
      } catch (err) { $("xfer-error").textContent = err.message; }
    };

    // users
    $("user-search").oninput = renderUsers;
    $("uf-role").onchange = renderUsers;
    bindSort("user-table", userSort, renderUsers);
    $("show-hidden").onchange = async () => { await refreshUsers(); renderUsers(); };
    $("new-user-btn").onclick = () => { $("users-dd-menu").classList.add("hidden"); showUserModal(null); };
    $("um-close").onclick = closeUserModal; $("uf-cancel").onclick = closeUserModal;
    $("user-form").onsubmit = async e => { e.preventDefault(); $("uf-error").textContent = ""; try { await saveUser(); } catch (err) { $("uf-error").textContent = err.message; } };

    // Dashboard (landing view)
    $("nav-dashboard").onclick = () => {
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      $("nav-dashboard").classList.add("active");
      showDashboard();
    };
    $("nav-glossary").onclick = () => {
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      $("nav-glossary").classList.add("active");
      showGlossary();
    };
    $("nav-reports").onclick = () => {
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      $("nav-reports").classList.add("active");
      showReports();
    };
    document.querySelectorAll("#rep-period button").forEach(b => b.onclick = () => loadReports(b.dataset.p));
    $("nav-canned").onclick = () => openCannedModal();   // review/edit outside a ticket
    $("gl-new-btn").onclick = () => openGlossaryModal(null);
    $("gl-close").onclick = closeGlossaryModal;
    $("gl-cancel").onclick = closeGlossaryModal;
    $("gl-search").oninput = renderGlossary;
    $("gl-form").onsubmit = async e => { e.preventDefault(); try { await saveGlossary(); } catch (err) { $("gl-error").textContent = err.message; } };
    // sidebar nav (ticket queues + manage sections) — only real nav links, not action buttons
    document.querySelectorAll(".nav-item[data-filter], .nav-item[data-section]").forEach(item => {
      item.onclick = () => {
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        item.classList.add("active");
        if (item.dataset.section === "customers") { showCustomers(); renderCustomers(); }
        else if (item.dataset.section === "users") { showUsers(); renderUsers(); }
        else { filter = item.dataset.filter; showQueue(); renderQueue(); }
      };
    });
    // toolbar
    $("search").oninput = renderQueue;
    bindSort("ticket-table", queueSort, renderQueue);
    $("f-status").onchange = renderQueue;
    $("f-priority").onchange = renderQueue;
    $("f-client").onchange = renderQueue;
    // column choosers
    renderColsMenu();
    $("cols-btn").onclick = e => { e.stopPropagation(); $("cols-menu").classList.toggle("hidden"); };
    $("cols-menu").onclick = e => e.stopPropagation();
    document.addEventListener("click", () => $("cols-menu").classList.add("hidden"));
    applyBizCols = setupColumnChooser({
      tableSel: "#customer-table", storageKey: "axus-biz-cols",
      btnId: "biz-cols-btn", menuId: "biz-cols-menu",
      columns: [{ key: "name", label: "Business Name" }, { key: "location", label: "Location" },
                { key: "phone", label: "Phone" }, { key: "website", label: "Website" },
                { key: "tickets", label: "Tickets" }, { key: "added", label: "Added" }],
    });
    applyUsrCols = setupColumnChooser({
      tableSel: "#user-table", storageKey: "axus-usr-cols",
      btnId: "usr-cols-btn", menuId: "usr-cols-menu",
      columns: [{ key: "name", label: "Name" }, { key: "email", label: "Email" },
                { key: "phone", label: "Phone" }, { key: "role", label: "Role" },
                { key: "business", label: "Business" }, { key: "tickets", label: "Tickets" },
                { key: "status", label: "Status" }, { key: "actions", label: "Actions" }],
    });

    // sidebar Business/Users: clicking the label shows the existing list on the right
    // AND opens the "＋ New …" dropdown underneath it.
    const wireNavDD = (btnId, menuId, showList) => {
      $(btnId).onclick = e => {
        e.stopPropagation();
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        $(btnId).classList.add("active");
        showList();                              // render the existing rows on the right
        $(menuId).classList.toggle("hidden");    // reveal ＋ New …
      };
      $(menuId).onclick = e => e.stopPropagation();
      document.addEventListener("click", () => $(menuId).classList.add("hidden"));
    };
    wireNavDD("business-dd-btn", "business-dd-menu", () => { showCustomers(); renderCustomers(); });
    wireNavDD("users-dd-btn", "users-dd-menu", () => { showUsers(); renderUsers(); });

    // detail controls
    // Moving a ticket to "Scheduled" requires a date+time FIRST: we reveal the picker
    // and defer committing the status until a time is chosen (sent together). Other
    // statuses commit immediately.
    $("d-status").onchange = e => {
      const v = e.target.value;
      if (v === "scheduled") {
        toggleScheduled("scheduled");
        const el = $("d-scheduled-date");
        if (!el.value) el.value = schedInputVal(current.scheduled_date);
        el.focus();
        if (el.showPicker) { try { el.showPicker(); } catch (_) {} }
        toast("Enter the scheduled date & time to confirm");
        // intentionally NOT patched yet — commit happens when the time is set
      } else {
        toggleScheduled(v);
        patch("status", v).catch(err => toast(err.message));
      }
    };
    function revertSchedule() {
      $("d-status").value = current.status;
      $("d-scheduled-date").value = schedInputVal(current.scheduled_date);
      toggleScheduled(current.status);
    }
    // Commit a Scheduled change only once the user has FINISHED entering the date+time —
    // not on every intermediate keystroke (datetime-local fires 'change' as soon as a
    // complete value exists, e.g. after the first minute digit). We debounce typing and
    // also commit immediately on blur or Enter. schedBusy guards against a double dialog.
    let schedTimer = null, schedBusy = false;
    async function commitSchedule() {
      if (schedBusy) return;                              // a confirm dialog is already open
      if ($("d-status").value !== "scheduled") return;
      const val = $("d-scheduled-date").value || null;
      if (!val) return;                                   // date+time not fully entered yet
      const rescheduling = current.status === "scheduled";
      if (rescheduling && schedInputVal(current.scheduled_date) === val) return;  // unchanged
      schedBusy = true;
      try {
        const when = schedDate(val);
        const ok = await axusConfirm(
          (rescheduling
            ? "Reschedule this ticket to:\n\n" + when + "\n\nThe client will be emailed the new scheduled date."
            : "Schedule this ticket for:\n\n" + when + "\n\nThe client will be emailed this scheduled date."),
          { title: rescheduling ? "Confirm reschedule" : "Confirm scheduled appointment",
            confirmText: rescheduling ? "Reschedule & notify client" : "Schedule & notify client" }
        );
        if (!ok) { revertSchedule(); return; }            // cancelled — nothing saved, no email
        if (rescheduling) await patch("scheduled_date", val);      // reschedule: update the time
        else await patchFields({ status: "scheduled", scheduled_date: val });  // commit together
      } catch (err) {
        toast(err.message);
        revertSchedule();
      } finally {
        schedBusy = false;
      }
    }
    // Typing: wait a moment after the last change (so the full date is entered) before asking.
    $("d-scheduled-date").oninput = () => {
      clearTimeout(schedTimer);
      schedTimer = setTimeout(commitSchedule, 600);
    };
    $("d-scheduled-date").onkeydown = e => {
      if (e.key === "Enter") { clearTimeout(schedTimer); commitSchedule(); }  // finished now
    };
    // Leaving the field: commit if a time was entered, else revert the "Scheduled" pick.
    $("d-scheduled-date").onblur = () => {
      clearTimeout(schedTimer);
      if ($("d-scheduled-date").value) {
        commitSchedule();
      } else if ($("d-status").value === "scheduled" && current.status !== "scheduled") {
        $("d-status").value = current.status;
        toggleScheduled(current.status);
      }
    };
    $("d-priority").onchange = e => patch("priority", e.target.value);
    $("d-assignee").onchange = e => { if (e.target.value) patch("assigned_to_id", parseInt(e.target.value)); };
    $("d-board").onchange = e => patch("board_id", e.target.value ? parseInt(e.target.value) : null);
    $("d-origin").onchange = e => { if (e.target.value) patch("origin", e.target.value); };
    // Change the ticket's Business after creation. The reporter/contact belongs to the
    // OLD business, so clear it — staff can pick a new contact via Edit ticket.
    $("d-business").onchange = async e => {
      const cid = parseInt(e.target.value);
      if (!cid || cid === current.client_id) return;
      const name = clientMap[cid] || "the selected business";
      if (!await axusConfirm(`Move this ticket to ${name}? The current contact (from the previous business) will be cleared.`)) {
        e.target.value = String(current.client_id); return;
      }
      try {
        await api(`/api/tickets/${current.id}`, { method: "PUT", body: { client_id: cid, reporter_user_id: 0 } });
        await loadTickets();
        await openTicket(current.id);   // refresh Business, contact, and the business's user list
        toast("Business updated");
      } catch (err) { toast(err.message); e.target.value = String(current.client_id); }
    };

    $("reply-internal").onchange = e => $("reply-form").classList.toggle("internal-mode", e.target.checked);
    // Attach files to the reply (click the box or drag & drop onto it) — same as the client portal.
    $("reply-files").onchange = renderReplyFiles;
    wireDropzone($("reply-upload-box"), files => { addFilesToInput($("reply-files"), files); renderReplyFiles(); });
    // AI assist buttons (staff console only)
    $("ai-rewrite").onclick = () => {
      const txt = $("reply-body").value.trim();
      if (!txt) { toast("Type a draft first, then Rewrite."); return; }
      aiAssist($("ai-rewrite"), "rewrite", { text: txt }, $("reply-body"));
    };
    $("ai-suggest").onclick = () => {
      if (!current || !current.id) { toast("Open a ticket first."); return; }
      aiAssist($("ai-suggest"), "suggest", { ticket_id: current.id }, $("reply-body"));
    };
    $("ai-rewrite-desc").onclick = async () => {
      const txt = $("nt-desc").value.trim();
      if (!txt) { toast("Type a description first, then Rewrite."); return; }
      const btn = $("ai-rewrite-desc");
      if (btn.disabled) return;
      const orig = btn.textContent; btn.disabled = true; btn.textContent = "✨ Thinking…";
      try {
        // Rewrite the description AND generate a Subject; fill the Subject only if it's blank.
        const r = await api("/api/ai/rewrite", { method: "POST", body: { text: txt, want_subject: true } });
        if (r && r.result) { $("nt-desc").value = r.result; $("nt-desc").style.height = ""; }
        if (r && r.subject && !$("nt-title").value.trim()) $("nt-title").value = r.subject;
        toast("AI draft ready — review before saving");
      } catch (e) { toast("AI: " + (e.message || "request failed")); }
      finally { btn.disabled = false; btn.textContent = orig; }
    };
    // --- Ask AI Assistant (conversational description helper) ---
    wireAskAssistant();
    $("canned-select").onchange = () => {
      const v = $("canned-select").value; $("canned-select").value = "";
      if (v === "__manage__") return openCannedModal();
      if (!v) return;
      const c = cannedData.find(x => String(x.id) === v);
      if (c) insertCanned(c.body);
    };
    $("canned-close").onclick = () => $("canned-modal").classList.add("hidden");
    $("canned-clear").onclick = clearCannedForm;
    $("canned-form").onsubmit = async e => {
      e.preventDefault(); $("canned-error").textContent = "";
      const id = $("canned-id").value;
      const body = { title: $("canned-title").value.trim(), body: $("canned-body").value.trim() };
      if (!body.title || !body.body) { $("canned-error").textContent = "Title and body are required."; return; }
      try {
        if (id) await api(`/api/canned/${id}`, { method: "PUT", body });
        else await api("/api/canned/", { method: "POST", body });
        await loadCanned(); renderCannedList(); clearCannedForm(); toast("Saved");
      } catch (err) { $("canned-error").textContent = err.message; }
    };
    $("reply-form").onsubmit = async e => {
      e.preventDefault();
      const b = $("reply-body").value.trim();
      const close = $("reply-close").checked;
      if (!b && !close) { toast("Please enter your message before posting."); return; }
      const internal = $("reply-internal").checked;
      const withSig = $("reply-signature").checked;
      const files = Array.from($("reply-files").files || []);
      try {
        await postReply(b, internal, files, close, withSig);
        // Clear the form only AFTER a successful post, so nothing is lost on error.
        $("reply-body").value = ""; $("reply-body").style.height = "";   // reset if it was dragged larger
        $("reply-internal").checked = false; $("reply-close").checked = false;
        $("reply-signature").checked = false;   // default: sign as "Axus Service Team"
        $("reply-form").classList.remove("internal-mode");
        $("reply-files").value = ""; renderReplyFiles();
      } catch (err) { toast("Couldn't post: " + err.message); }
    };
    $("time-form").onsubmit = async e => {
      e.preventDefault(); const h = parseFloat($("time-hours").value); if (!h) return;
      const notes = $("time-notes").value.trim();
      $("time-hours").value = ""; $("time-notes").value = "";
      try { await logTime(h, notes); } catch (err) { toast(err.message); }
    };
    $("attach-input").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await uploadFile(f); } catch (err) { toast(err.message); }
      e.target.value = "";
    };
    $("new-form").onsubmit = async e => {
      e.preventDefault(); $("nt-error").textContent = "";
      const clientId = $("nt-client").value;
      if (!clientId) { $("nt-error").textContent = "Please choose a business"; return; }
      const payload = {
        title: $("nt-title").value.trim(),
        description: $("nt-desc").value.trim() || null,
        category: $("nt-category").value || null,
        priority: $("nt-priority").value,
        client_id: parseInt(clientId),
      };
      const a = $("nt-assignee").value; if (a) payload.assigned_to_id = parseInt(a);
      const ct = $("nt-contact").value; if (ct) payload.reporter_user_id = parseInt(ct);
      const bd = $("nt-board").value; if (bd) payload.board_id = parseInt(bd);
      const pj = $("nt-project").value; if (pj) payload.project_id = parseInt(pj);
      const og = $("nt-origin").value; if (og) payload.origin = og;
      payload.contact_address = $("nt-address").value.trim() || null;
      payload.contact_phone = $("nt-phone").value.trim() || null;
      payload.po_number = $("nt-po").value.trim() || null;
      try {
        if (ticketEditId) {
          await api(`/api/tickets/${ticketEditId}`, { method: "PUT", body: payload });
          closeNew(); await loadTickets(); await openTicket(ticketEditId);
          toast("Ticket updated");
        } else {
          await createTicket(payload, Array.from($("nt-files").files || []));
        }
      } catch (err) { $("nt-error").textContent = err.message; }
    };

    // Try an existing session (stored JWT locally, or gateway identity in
    // central mode); fall back to the login screen.
    try { await enter(); } catch (e) { showLogin(); }
    startSsoWatch();   // auto-recover if the SSO gateway session later expires
    startLiveRefresh();   // keep the queue + open case live without a manual refresh
  }
  async function enter() { await loadAll(); showApp(); showDashboard(); }

  return { start };
})();

document.addEventListener("DOMContentLoaded", Staff.start);

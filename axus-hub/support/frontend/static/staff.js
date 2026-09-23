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
    const res = await fetch(path, { method, headers, body: payload });
    if (res.status === 401) { logout(); throw new Error("Session expired"); }
    if (!res.ok) {
      let d = res.statusText;
      try { const j = await res.json(); d = typeof j.detail === "string" ? j.detail : d; } catch (e) {}
      const err = new Error(d); err.status = res.status; throw err;
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
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
  function fmtDate(s) { if (!s) return ""; return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function fileSize(b) { if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(0) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2400); }
  const ACTIVE = ["open", "in_progress", "waiting"];

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
  const showApp = () => { $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); };
  const VIEWS = ["dashboard-view", "queue-view", "detail-view", "customers-view", "customer-detail-view", "users-view", "glossary-view"];
  const hideViews = () => VIEWS.forEach(id => $(id).classList.add("hidden"));
  const showDashboard = () => { hideViews(); $("dashboard-view").classList.remove("hidden"); renderDashboard(); };
  const showQueue = () => { hideViews(); $("queue-view").classList.remove("hidden"); };
  const showDetail = () => { hideViews(); $("detail-view").classList.remove("hidden"); };
  const showCustomers = () => { hideViews(); $("customers-view").classList.remove("hidden"); requestAnimationFrame(() => makeResizable("#customer-table", "axus-biz-widths")); };
  const showCustomerDetail = () => { hideViews(); $("customer-detail-view").classList.remove("hidden"); };
  const showUsers = () => { hideViews(); $("users-view").classList.remove("hidden"); requestAnimationFrame(() => makeResizable("#user-table", "axus-usr-widths")); };
  const showGlossary = () => { hideViews(); $("glossary-view").classList.remove("hidden"); loadGlossary(); };

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
    const pairs = clientsData.map(c => [c.id, c.company_name]);
    [["f-client", "All companies"], ["nt-client", null], ["uf-client", "— None —"]].forEach(([id, ph]) => {
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

  async function loadTickets() { tickets = await api("/api/tickets/"); renderCounts(); renderStats(); renderQueue(); renderDashboard(); }

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
        <span class="badge ${t.status}">${cap(t.status)}</span>
        <span class="dash-co cell-muted">${esc(t.client_name || clientMap[t.client_id] || "—")}</span>
      </div>`;
    const fill = (elId, rows, empty) => {
      const el = $(elId);
      el.innerHTML = rows.length ? rows.slice(0, 12).map(rowHtml).join("") : `<div class="muted dash-empty">${empty}</div>`;
      el.querySelectorAll(".dash-row").forEach(r => r.onclick = () => openTicket(parseInt(r.dataset.id)));
    };
    fill("dash-mine", mine, "Nothing assigned to you.");
    fill("dash-unassigned", unassigned, "No unassigned tickets.");
    $("dash-mine-count").textContent = `(${mine.length})`;
    $("dash-unassigned-count").textContent = `(${unassigned.length})`;

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
    }).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

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
        <td class="col-status"><span class="badge ${t.status}">${cap(t.status)}</span></td>
        <td class="col-assignee">${aName
          ? `<span class="assignee-pill"><span class="mini-avatar" style="${avatarStyle(avatarColor(aName))}">${initials(aName)}</span>${esc(aName)}</span>`
          : `<span class="assignee-pill"><span class="mini-avatar none">?</span><span class="cell-muted">Unassigned</span></span>`}</td>
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
    { key: "assignee", label: "Assignee" }, { key: "updated", label: "Updated" },
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
      th.style.position = "relative";
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
    $("d-priority").value = current.priority;
    $("d-assignee").value = current.assigned_to_id || "";
    $("d-board").value = current.board_id || "";
    $("d-origin").value = current.origin || "";
    $("p-company").textContent = clientMap[current.client_id] || "—";
    $("p-category").textContent = current.category || "Uncategorized";
    const isProject = current.ticket_type === "sow";
    $("p-type").textContent = isProject ? "Project (SOW)" : "Standard";
    $("convert-project-btn").style.display = isProject ? "none" : "";  // hide once it's a project
    $("delete-ticket-btn").hidden = !(me && me.role === "admin");      // admins only
    $("promote-btn").hidden = true;                                    // native tickets are already editable
    $("p-hours").textContent = (current.total_hours || 0) + " h";
    $("p-created").textContent = fmtDate(current.created_at);
    // resolve the reporting user's name
    if (current.reporter_user_id) {
      try { const us = await api(`/api/clients/${current.client_id}/portal-users`); const u = us.find(x => x.id === current.reporter_user_id); $("p-contact").textContent = u ? u.full_name : "—"; }
      catch (e) { $("p-contact").textContent = "—"; }
    } else { $("p-contact").textContent = "—"; }
    $("reply-internal").checked = false; $("reply-form").classList.remove("internal-mode");
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
    if (!confirm("Convert this ticket into a Project? It will move to the Projects board and be assigned.")) return;
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
    if (!confirm("Delete this note?")) return;
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
    }
    if (field === "priority") {
      $("d-prio-badge").className = "prio-badge " + value;
      $("d-prio-badge").textContent = prioLabel(value);
      $("d-prio-badge").title = PRIO_MEANING[value] || "";
    }
    toast(cap(field) + " updated");
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
      if (!confirm("Delete this canned response?")) return;
      try { await api(`/api/canned/${a.dataset.del}`, { method: "DELETE" }); await loadCanned(); renderCannedList(); clearCannedForm(); toast("Deleted"); }
      catch (err) { toast(err.message); }
    });
  }
  async function postReply(bodyText, internal, files, close, withSig) {
    // Public replies (visible to the customer) get a sign-off: the staff member's
    // personal signature when "Include my signature" is on, otherwise "Axus Service Team".
    let body = bodyText || "";
    if (body && !internal) {
      body += (withSig && me.signature) ? "\n\n" + me.signature : "\n\nAxus Service Team";
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
    await Promise.all([loadThread(current.id), loadActivity(current.id), loadAttachments(current.id)]);
    if (close) await openTicket(current.id);   // refresh status/priority badges after closing
    toast(close ? "Case closed" : (internal ? "Internal note added" : "Reply posted"));
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
      if (!confirm("Delete this glossary term?")) return;
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
    if (!confirm("Import this Xcitium ticket into Axus so you can edit it?\n\nThe imported copy becomes a normal editable ticket, and the hourly sync will no longer overwrite it.")) return;
    try {
      const r = await api(`/api/xcitium/tickets/${ext}/promote`, { method: "POST" });
      toast("Imported — now editable");
      await loadTickets();
      await openTicket(r.id);
    } catch (err) { toast(err.message); }
  }
  async function deleteTicket() {
    const ref = current.reference || "this ticket";
    if (!confirm(`Permanently delete ${ref}?\n\nThis removes the ticket and all of its replies, notes, time entries, and attachments. This cannot be undone.`)) return;
    try {
      await api(`/api/tickets/${current.id}`, { method: "DELETE" });
      toast(`Deleted ${ref}`);
      showQueue(); await loadTickets();
    } catch (err) { toast(err.message); }
  }
  async function createTicket(payload) {
    const t = await api("/api/tickets/", { method: "POST", body: payload });
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

  function renderCustomers() {
    const q = ($("cust-search").value || "").toLowerCase();
    const rows = clientsData
      .filter(c => !q || `${c.company_name} ${c.location || ""} ${c.website || ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
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
    showCustomerDetail();
    const users = await api(`/api/clients/${id}/portal-users`);
    $("cd-users").innerHTML = users.length
      ? users.map(u => `<div class="time-item"><span>${esc(u.full_name)}<br><span class="cell-muted">${esc(u.email)}</span></span></div>`).join("")
      : `<div class="muted">No users yet.</div>`;
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

  function renderUsers() {
    const q = ($("user-search").value || "").toLowerCase();
    const fr = $("uf-role").value;
    const roleMatch = u => !fr ? true
      : fr === "staff" ? (u.role === "admin" || u.role === "technician")
      : u.role === fr;
    const rows = usersData
      .filter(roleMatch)
      .filter(u => !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
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
        if (!confirm(`Delete ${del.dataset.delName}?\n\nThey will not be re-created when Xcitium syncs.`)) return;
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
    $("new-modal").classList.remove("hidden");
    // load the business's users, then select the current reporter
    await loadUsersInto($("nt-contact"), String(t.client_id));
    $("nt-contact").value = t.reporter_user_id ? String(t.reporter_user_id) : "";
  }
  const closeNew = () => { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-error").textContent = ""; ticketEditId = null; };

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
    $("new-customer-btn").onclick = () => { $("business-dd-menu").classList.add("hidden"); showCustModal(null); };
    $("cust-modal-close").onclick = closeCustModal; $("cf-cancel").onclick = closeCustModal;
    $("cust-back-btn").onclick = () => { showCustomers(); renderCustomers(); };
    $("cd-edit-btn").onclick = () => showCustModal(currentCustomer);
    $("cust-form").onsubmit = async e => { e.preventDefault(); $("cf-error").textContent = ""; try { await saveCustomer(); } catch (err) { $("cf-error").textContent = err.message; } };
    $("cd-adduser-btn").onclick = () => { $("pu-error").textContent = ""; $("pu-form").reset(); $("puser-modal").classList.remove("hidden"); };
    $("pu-close").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-cancel").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-form").onsubmit = async e => { e.preventDefault(); $("pu-error").textContent = ""; try { await addPortalUser(); } catch (err) { $("pu-error").textContent = err.message; } };
    // reset portal password

    // ticket form: load users when business changes
    $("nt-client").onchange = () => loadUsersInto($("nt-contact"), $("nt-client").value);

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
    $("d-status").onchange = e => patch("status", e.target.value);
    $("d-priority").onchange = e => patch("priority", e.target.value);
    $("d-assignee").onchange = e => { if (e.target.value) patch("assigned_to_id", parseInt(e.target.value)); };
    $("d-board").onchange = e => patch("board_id", e.target.value ? parseInt(e.target.value) : null);
    $("d-origin").onchange = e => { if (e.target.value) patch("origin", e.target.value); };

    $("reply-internal").onchange = e => $("reply-form").classList.toggle("internal-mode", e.target.checked);
    $("reply-files").onchange = () => {
      const n = $("reply-files").files.length;
      $("reply-files-label").textContent = n ? `${n} file${n > 1 ? "s" : ""}` : "Attach";
    };
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
      $("reply-body").value = ""; $("reply-internal").checked = false; $("reply-close").checked = false;
      $("reply-signature").checked = false;   // default: sign as "Axus Service Team"
      $("reply-form").classList.remove("internal-mode");
      $("reply-files").value = ""; $("reply-files-label").textContent = "Attach";
      try {
        await postReply(b, internal, files, close, withSig);
      } catch (err) { toast(err.message); }
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
      try {
        if (ticketEditId) {
          await api(`/api/tickets/${ticketEditId}`, { method: "PUT", body: payload });
          closeNew(); await loadTickets(); await openTicket(ticketEditId);
          toast("Ticket updated");
        } else {
          await createTicket(payload);
        }
      } catch (err) { $("nt-error").textContent = err.message; }
    };

    // Try an existing session (stored JWT locally, or gateway identity in
    // central mode); fall back to the login screen.
    try { await enter(); } catch (e) { showLogin(); }
  }
  async function enter() { await loadAll(); showApp(); showDashboard(); }

  return { start };
})();

document.addEventListener("DOMContentLoaded", Staff.start);

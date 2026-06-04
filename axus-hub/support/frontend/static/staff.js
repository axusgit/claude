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
      throw new Error(d);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  /* ---------- Helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = n => (n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const cap = s => (s || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  function fmtDate(s) { if (!s) return ""; return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function fileSize(b) { if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(0) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2400); }
  const ACTIVE = ["open", "in_progress", "waiting"];

  /* ---------- Views ---------- */
  const showLogin = () => { $("login-view").classList.remove("hidden"); $("app-view").classList.add("hidden"); };
  const showApp = () => { $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); };
  const VIEWS = ["queue-view", "detail-view", "customers-view", "customer-detail-view", "users-view"];
  const hideViews = () => VIEWS.forEach(id => $(id).classList.add("hidden"));
  const showQueue = () => { hideViews(); $("queue-view").classList.remove("hidden"); };
  const showDetail = () => { hideViews(); $("detail-view").classList.remove("hidden"); };
  const showCustomers = () => { hideViews(); $("customers-view").classList.remove("hidden"); };
  const showCustomerDetail = () => { hideViews(); $("customer-detail-view").classList.remove("hidden"); };
  const showUsers = () => { hideViews(); $("users-view").classList.remove("hidden"); };

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
    $("who-role").textContent = cap(me.role);
    $("profile-av").textContent = initials(me.full_name);
    $("pm-name").textContent = me.full_name;
    $("pm-email").textContent = me.email;
    // Only admins may change system configuration (users/access). Technicians get
    // everything else; the config UI is hidden for them.
    const isAdmin = me.role === "admin";
    const usersNav = document.querySelector('[data-section="users"]');
    if (usersNav) usersNav.style.display = isAdmin ? "" : "none";
    if ($("cd-adduser-btn")) $("cd-adduser-btn").style.display = isAdmin ? "" : "none";
    const [cl, us, bd] = await Promise.all([api("/api/clients/"), api("/api/users/"), api("/api/boards/")]);
    clientsData = cl; usersData = us; boardsData = bd;
    clientMap = {}; cl.forEach(c => clientMap[c.id] = c.company_name);
    userMap = {}; us.forEach(u => userMap[u.id] = u.full_name);
    boardMap = {}; bd.forEach(b => boardMap[b.id] = b.name);
    staffUsers = us.filter(u => u.role !== "client");
    $("c-customers").textContent = cl.length;
    $("c-users").textContent = us.length;
    // populate company + assignee + board selects
    fillSelect($("f-client"), cl.map(c => [c.id, c.company_name]), "All companies");
    fillSelect($("nt-client"), cl.map(c => [c.id, c.company_name]), null);
    fillSelect($("nt-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    fillSelect($("d-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    fillSelect($("uf-client"), cl.map(c => [c.id, c.company_name]), "— None —");
    fillSelect($("nt-board"), bd.map(b => [b.id, b.name]), "— None —");
    fillSelect($("d-board"), bd.map(b => [b.id, b.name]), "— None —");
    renderBoardNav();
    await loadTickets();
  }
  function fillSelect(sel, pairs, placeholder) {
    sel.innerHTML = (placeholder !== null ? `<option value="">${placeholder}</option>` : "") +
      pairs.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  }

  async function loadTickets() { tickets = await api("/api/tickets/"); renderCounts(); renderStats(); renderQueue(); }

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
    const fp = $("f-priority").value, fc = $("f-client").value;
    const rows = tickets.filter(matchesFilter).filter(t => {
      if (fp && t.priority !== fp) return false;
      if (fc && String(t.client_id) !== fc) return false;
      if (q) {
        const hay = `${t.reference} ${t.title} ${clientMap[t.client_id] || ""}`.toLowerCase();
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
        <td class="cell-ref col-ref">${esc(t.reference || "")}</td>
        <td class="cell-subject col-subject">${esc(t.title)}</td>
        <td class="cell-muted col-company">${esc(clientMap[t.client_id] || "—")}</td>
        <td class="cell-muted col-board">${t.board_id ? esc(boardMap[t.board_id] || "—") : "—"}</td>
        <td class="col-priority"><span class="prio-dot prio ${t.priority}">${cap(t.priority)}</span></td>
        <td class="col-status"><span class="badge ${t.status}">${cap(t.status)}</span></td>
        <td class="col-assignee">${aName
          ? `<span class="assignee-pill"><span class="mini-avatar">${initials(aName)}</span>${esc(aName)}</span>`
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
      document.querySelectorAll(`.ticket-table .col-${c.key}`).forEach(el => el.style.display = hide ? "none" : "");
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

  /* ---------- Detail ---------- */
  async function openTicket(id) {
    current = await api(`/api/tickets/${id}`);
    $("d-ref").textContent = current.reference || "";
    $("d-title").textContent = current.title;
    $("d-desc").textContent = current.description || "No description provided.";
    $("d-status").value = current.status;
    $("d-priority").value = current.priority;
    $("d-assignee").value = current.assigned_to_id || "";
    $("d-board").value = current.board_id || "";
    $("p-company").textContent = clientMap[current.client_id] || "—";
    $("p-category").textContent = current.category || "Uncategorized";
    const isProject = current.ticket_type === "sow";
    $("p-type").textContent = isProject ? "Project (SOW)" : "Standard";
    $("convert-project-btn").style.display = isProject ? "none" : "";  // hide once it's a project
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
    } else if (eligible.length) {
      wrap.innerHTML = `<div class="tu-add"><select id="tu-select">` +
        eligible.map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.email)})</option>`).join("") +
        `</select><button type="button" class="btn btn-primary btn-xs" id="tu-add-btn">+ Add</button></div>`;
      $("tu-add-btn").onclick = addWatcher;
    } else {
      // nobody left to add — point staff to where business users are created
      wrap.innerHTML = `<p class="muted tu-hint">No other users in this business to add. ` +
        `Create them under <a id="tu-goto-biz" class="tu-link">Business → Users</a>.</p>`;
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

  async function loadThread(id) {
    const comments = await api(`/api/tickets/${id}/comments`);
    const el = $("thread");
    if (!comments.length) { el.innerHTML = `<div class="thread-empty">No replies yet.</div>`; return; }
    el.innerHTML = comments.map(c => {
      const mine = c.author_id === me.id;
      const who = userMap[c.author_id] || (mine ? "You" : "User");
      const canEdit = me.role === "admin" || c.author_id === me.id;
      return `<div class="msg ${mine ? "me" : "them"} ${c.is_internal ? "internal" : ""}">
        <div class="msg-avatar">${initials(who)}</div>
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
    if (field === "status") { current = await api(`/api/tickets/${current.id}`); }
    toast(cap(field) + " updated");
  }
  async function postReply(bodyText, internal) {
    // public replies (visible to the customer) get the staff member's signature appended
    let body = bodyText;
    if (!internal && me.signature) body += "\n\n" + me.signature;
    await api(`/api/tickets/${current.id}/comments`, { method: "POST", body: { body, is_internal: internal } });
    await Promise.all([loadThread(current.id), loadActivity(current.id)]);
    toast(internal ? "Internal note added" : "Reply posted");
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
      const tcount = tickets.filter(t => t.client_id === c.id).length;
      const tr = document.createElement("tr");
      tr.onclick = () => openCustomer(c.id);
      tr.innerHTML = `
        <td class="cell-subject">${esc(c.company_name)}</td>
        <td class="cell-muted">${esc(c.location || "—")}</td>
        <td class="cell-muted">${esc(c.phone || "—")}${c.ext ? " x" + esc(c.ext) : ""}</td>
        <td class="cell-muted">${esc(c.website || "—")}</td>
        <td>${tcount}</td>
        <td class="cell-muted">${c.created_at ? fmtDate(c.created_at) : "—"}</td>`;
      tbody.appendChild(tr);
    }
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
      ? users.map(u => `<div class="time-item"><span>${esc(u.full_name)}<br><span class="cell-muted">${esc(u.email)}</span></span>` +
          `<button class="btn btn-ghost btn-xs" data-reset-pw="${u.id}" data-reset-name="${esc(u.full_name)}">Reset password</button></div>`).join("")
      : `<div class="muted">No users yet.</div>`;
    $("cd-users").querySelectorAll("[data-reset-pw]").forEach(b => {
      b.onclick = () => showPwReset(`/api/clients/${currentCustomer.id}/portal-users/${b.dataset.resetPw}/password`, b.dataset.resetName);
    });
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
      body: { full_name: $("pu-name").value.trim(), email: $("pu-email").value.trim(), password: $("pu-password").value },
    });
    $("puser-modal").classList.add("hidden"); $("pu-form").reset();
    await openCustomer(currentCustomer.id);
    toast("User created");
  }

  /* ---------- Reset password (works for business users and staff users) ---------- */
  let pwResetUrl = null;
  function genPassword() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", b = "abcdefghijkmnpqrstuvwxyz", n = "23456789", s = "!@#$%&*";
    const all = a + b + n + s; const rnd = x => x[Math.floor(Math.random() * x.length)];
    let out = [rnd(a), rnd(b), rnd(n), rnd(s)];
    for (let i = 0; i < 8; i++) out.push(rnd(all));
    return out.sort(() => Math.random() - 0.5).join("");
  }
  function showPwReset(url, name) {
    pwResetUrl = url;
    $("pwr-who").textContent = name;
    $("pwr-password").value = ""; $("pwr-error").textContent = "";
    $("pwreset-modal").classList.remove("hidden");
    $("pwr-password").focus();
  }
  async function submitPwReset() {
    const pw = $("pwr-password").value.trim();
    if (pw.length < 8) { $("pwr-error").textContent = "Password must be at least 8 characters"; return; }
    await api(pwResetUrl, { method: "PUT", body: { password: pw } });
    $("pwreset-modal").classList.add("hidden");
    toast("Password reset");
  }

  /* ---------- Users ---------- */
  let userEditId = null;
  const roleBadge = { admin: "waiting", technician: "open", client: "in_progress" };

  async function refreshUsers() {
    usersData = await api("/api/users/");
    userMap = {}; usersData.forEach(u => userMap[u.id] = u.full_name);
    staffUsers = usersData.filter(u => u.role !== "client");
    $("c-users").textContent = usersData.length;
  }

  function renderUsers() {
    const q = ($("user-search").value || "").toLowerCase();
    const fr = $("uf-role").value;
    const rows = usersData
      .filter(u => !fr || u.role === fr)
      .filter(u => !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    $("users-summary").textContent = `${usersData.length} user${usersData.length === 1 ? "" : "s"}`;
    const tbody = $("user-rows"); tbody.innerHTML = "";
    $("users-empty").classList.toggle("hidden", rows.length > 0);
    for (const u of rows) {
      const tr = document.createElement("tr");
      tr.onclick = () => showUserModal(u);
      tr.innerHTML = `
        <td class="cell-subject">${esc(u.full_name)}</td>
        <td class="cell-muted">${esc(u.email)}</td>
        <td class="cell-muted">${esc(u.phone || "—")}</td>
        <td><span class="badge ${roleBadge[u.role] || "closed"}">${cap(u.role)}</span></td>
        <td class="cell-muted">${u.client_id ? esc(clientMap[u.client_id] || "—") : "—"}</td>
        <td><span class="badge ${u.is_active ? "resolved" : "closed"}">${u.is_active ? "Active" : "Inactive"}</span></td>
        <td><button class="btn btn-ghost btn-xs" data-reset-pw="${u.id}" data-reset-name="${esc(u.full_name)}">Reset password</button></td>`;
      const rb = tr.querySelector("[data-reset-pw]");
      rb.onclick = (e) => { e.stopPropagation(); showPwReset(`/api/users/${rb.dataset.resetPw}/password`, rb.dataset.resetName); };
      tbody.appendChild(tr);
    }
  }

  function showUserModal(u) {
    $("uf-error").textContent = "";
    if (u) {
      $("user-modal-title").textContent = "Edit User";
      $("uf-name").value = u.full_name; $("uf-email").value = u.email;
      $("uf-phone").value = u.phone || ""; $("uf-roleSel").value = u.role;
      $("uf-active").value = String(u.is_active); $("uf-client").value = u.client_id || "";
      userEditId = u.id;
      $("uf-pw-wrap").style.display = "none";   // no password change on edit
    } else {
      $("user-modal-title").textContent = "New User";
      $("user-form").reset(); userEditId = null;
      $("uf-pw-wrap").style.display = "";
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
      const pw = $("uf-password").value;
      if (!pw) { $("uf-error").textContent = "Password is required for a new user"; return; }
      await api("/api/users/", { method: "POST", body: { ...base, password: pw } });
    }
    closeUserModal();
    await Promise.all([refreshUsers(), refreshClients()]);
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
    $("sig-close").onclick = () => $("sig-modal").classList.add("hidden");
    $("sig-cancel").onclick = () => $("sig-modal").classList.add("hidden");
    $("sig-save").onclick = saveSignature;
    $("sig-logo-pick").onclick = () => $("sig-logo-file").click();
    $("sig-logo-file").onchange = e => { onLogoPicked(e.target.files[0]); e.target.value = ""; };
    $("sig-logo-remove").onclick = () => { sigLogo = ""; renderSigLogo(); };
    $("new-ticket-btn").onclick = showNew;
    $("edit-ticket-btn").onclick = () => showEditTicket();
    $("convert-project-btn").onclick = convertToProject;
    $("pt-add-btn").onclick = newTicketInProject;
    $("modal-close").onclick = closeNew; $("nt-cancel").onclick = closeNew;
    $("back-btn").onclick = () => { showQueue(); };

    // customers
    $("cust-search").oninput = renderCustomers;
    $("new-customer-btn").onclick = () => showCustModal(null);
    $("cust-modal-close").onclick = closeCustModal; $("cf-cancel").onclick = closeCustModal;
    $("cust-back-btn").onclick = () => { showCustomers(); renderCustomers(); };
    $("cd-edit-btn").onclick = () => showCustModal(currentCustomer);
    $("cust-form").onsubmit = async e => { e.preventDefault(); $("cf-error").textContent = ""; try { await saveCustomer(); } catch (err) { $("cf-error").textContent = err.message; } };
    $("cd-adduser-btn").onclick = () => { $("pu-error").textContent = ""; $("pu-form").reset(); $("puser-modal").classList.remove("hidden"); };
    $("pu-close").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-cancel").onclick = () => $("puser-modal").classList.add("hidden");
    $("pu-form").onsubmit = async e => { e.preventDefault(); $("pu-error").textContent = ""; try { await addPortalUser(); } catch (err) { $("pu-error").textContent = err.message; } };
    // reset portal password
    $("pwr-close").onclick = () => $("pwreset-modal").classList.add("hidden");
    $("pwr-cancel").onclick = () => $("pwreset-modal").classList.add("hidden");
    $("pwr-gen").onclick = () => { $("pwr-password").value = genPassword(); };
    $("pwr-form").onsubmit = async e => { e.preventDefault(); $("pwr-error").textContent = ""; try { await submitPwReset(); } catch (err) { $("pwr-error").textContent = err.message; } };

    // ticket form: load users when business changes
    $("nt-client").onchange = () => loadUsersInto($("nt-contact"), $("nt-client").value);

    // users
    $("user-search").oninput = renderUsers;
    $("uf-role").onchange = renderUsers;
    $("new-user-btn").onclick = () => showUserModal(null);
    $("um-close").onclick = closeUserModal; $("uf-cancel").onclick = closeUserModal;
    $("user-form").onsubmit = async e => { e.preventDefault(); $("uf-error").textContent = ""; try { await saveUser(); } catch (err) { $("uf-error").textContent = err.message; } };

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
    $("f-priority").onchange = renderQueue;
    $("f-client").onchange = renderQueue;
    // column chooser
    renderColsMenu();
    $("cols-btn").onclick = e => { e.stopPropagation(); $("cols-menu").classList.toggle("hidden"); };
    $("cols-menu").onclick = e => e.stopPropagation();
    document.addEventListener("click", () => $("cols-menu").classList.add("hidden"));

    // detail controls
    $("d-status").onchange = e => patch("status", e.target.value);
    $("d-priority").onchange = e => patch("priority", e.target.value);
    $("d-assignee").onchange = e => { if (e.target.value) patch("assigned_to_id", parseInt(e.target.value)); };
    $("d-board").onchange = e => patch("board_id", e.target.value ? parseInt(e.target.value) : null);

    $("reply-internal").onchange = e => $("reply-form").classList.toggle("internal-mode", e.target.checked);
    $("reply-form").onsubmit = async e => {
      e.preventDefault(); const b = $("reply-body").value.trim(); if (!b) return;
      const internal = $("reply-internal").checked;
      $("reply-body").value = ""; $("reply-internal").checked = false;
      $("reply-form").classList.remove("internal-mode");
      try { await postReply(b, internal); } catch (err) { toast(err.message); }
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
  async function enter() { await loadAll(); showApp(); showQueue(); }

  return { start };
})();

document.addEventListener("DOMContentLoaded", Staff.start);

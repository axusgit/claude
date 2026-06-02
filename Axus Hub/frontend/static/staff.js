/* ===================== Axus Hub — Service Desk console ===================== */
const Staff = (() => {
  const TOKEN_KEY = "axus-staff-token";
  const THEME_KEY = "axus-theme";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let me = null;
  let tickets = [];                 // full set
  let clientMap = {}, userMap = {}; // id -> name
  let staffUsers = [];              // assignable
  let filter = "open";
  let current = null;               // open ticket object

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
  const showQueue = () => { $("queue-view").classList.remove("hidden"); $("detail-view").classList.add("hidden"); };
  const showDetail = () => { $("queue-view").classList.add("hidden"); $("detail-view").classList.remove("hidden"); };

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
    const [cl, us] = await Promise.all([api("/api/clients/"), api("/api/users/")]);
    clientMap = {}; cl.forEach(c => clientMap[c.id] = c.company_name);
    userMap = {}; us.forEach(u => userMap[u.id] = u.full_name);
    staffUsers = us.filter(u => u.role !== "client");
    // populate company + assignee selects
    fillSelect($("f-client"), cl.map(c => [c.id, c.company_name]), "All companies");
    fillSelect($("nt-client"), cl.map(c => [c.id, c.company_name]), null);
    fillSelect($("nt-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    fillSelect($("d-assignee"), staffUsers.map(u => [u.id, u.full_name]), "Unassigned");
    await loadTickets();
  }
  function fillSelect(sel, pairs, placeholder) {
    sel.innerHTML = (placeholder !== null ? `<option value="">${placeholder}</option>` : "") +
      pairs.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  }

  async function loadTickets() { tickets = await api("/api/tickets/"); renderCounts(); renderStats(); renderQueue(); }

  /* ---------- Queue ---------- */
  function matchesFilter(t) {
    switch (filter) {
      case "open": return ACTIVE.includes(t.status);
      case "unassigned": return ACTIVE.includes(t.status) && !t.assigned_to_id;
      case "mine": return ACTIVE.includes(t.status) && t.assigned_to_id === me.id;
      case "waiting": return t.status === "waiting";
      case "in_progress": return t.status === "in_progress";
      case "resolved": return t.status === "resolved";
      default: return true; // all
    }
  }
  function renderCounts() {
    const c = f => tickets.filter(t => {
      const saved = filter; filter = f; const r = matchesFilter(t); filter = saved; return r;
    }).length;
    $("c-open").textContent = c("open"); $("c-unassigned").textContent = c("unassigned");
    $("c-mine").textContent = c("mine"); $("c-waiting").textContent = c("waiting");
    $("c-inprogress").textContent = c("in_progress"); $("c-resolved").textContent = c("resolved");
    $("c-all").textContent = tickets.length;
  }
  function renderStats() {
    const open = tickets.filter(t => ACTIVE.includes(t.status)).length;
    const unassigned = tickets.filter(t => ACTIVE.includes(t.status) && !t.assigned_to_id).length;
    const inprog = tickets.filter(t => t.status === "in_progress").length;
    const resolved = tickets.filter(t => t.status === "resolved").length;
    $("stats-row").innerHTML = `
      ${statCard(open, "Open tickets", "accent")}
      ${statCard(unassigned, "Unassigned", unassigned ? "danger" : "")}
      ${statCard(inprog, "In progress", "")}
      ${statCard(resolved, "Resolved", "good")}`;
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
        <td class="cell-ref">${esc(t.reference || "")}</td>
        <td class="cell-subject">${esc(t.title)}</td>
        <td class="cell-muted">${esc(clientMap[t.client_id] || "—")}</td>
        <td><span class="prio-dot prio ${t.priority}">${cap(t.priority)}</span></td>
        <td><span class="badge ${t.status}">${cap(t.status)}</span></td>
        <td>${aName
          ? `<span class="assignee-pill"><span class="mini-avatar">${initials(aName)}</span>${esc(aName)}</span>`
          : `<span class="assignee-pill"><span class="mini-avatar none">?</span><span class="cell-muted">Unassigned</span></span>`}</td>
        <td class="cell-muted">${fmtDate(t.updated_at || t.created_at)}</td>`;
      tbody.appendChild(tr);
    }
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
    $("p-company").textContent = clientMap[current.client_id] || "—";
    $("p-category").textContent = current.category || "Uncategorized";
    $("p-type").textContent = current.ticket_type === "sow" ? "SOW / Project" : "Standard";
    $("p-hours").textContent = (current.total_hours || 0) + " h";
    $("p-created").textContent = fmtDate(current.created_at);
    showDetail();
    await Promise.all([loadThread(id), loadTime(id), loadAttachments(id), loadActivity(id)]);
  }

  async function loadThread(id) {
    const comments = await api(`/api/tickets/${id}/comments`);
    const el = $("thread");
    if (!comments.length) { el.innerHTML = `<div class="thread-empty">No replies yet.</div>`; return; }
    el.innerHTML = comments.map(c => {
      const mine = c.author_id === me.id;
      const who = userMap[c.author_id] || (mine ? "You" : "User");
      return `<div class="msg ${mine ? "me" : "them"} ${c.is_internal ? "internal" : ""}">
        <div class="msg-avatar">${initials(who)}</div>
        <div class="msg-bubble">
          <div class="msg-meta">${esc(who)} · ${fmtDate(c.created_at)} ${c.is_internal ? '<span class="internal-tag">Internal</span>' : ""}</div>
          <div class="msg-body">${esc(c.body)}</div>
        </div></div>`;
    }).join("");
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

  async function loadActivity(id) {
    const acts = await api(`/api/tickets/${id}/activity`);
    $("activity").innerHTML = acts.slice().reverse().map(a => `
      <div class="act-item"><div class="act-dot"></div><div class="act-body">
        <div class="act-detail">${esc(a.detail || cap(a.action))}</div>
        <div class="act-time">${a.user_id ? esc(userMap[a.user_id] || "User") + " · " : ""}${fmtDate(a.created_at)}</div>
      </div></div>`).join("");
  }

  async function download(attId, filename) {
    const res = await api(`/api/tickets/${current.id}/attachments/${attId}`);
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
    await api(`/api/tickets/${current.id}/comments`, { method: "POST", body: { body: bodyText, is_internal: internal } });
    await Promise.all([loadThread(current.id), loadActivity(current.id)]);
    toast(internal ? "Internal note added" : "Reply posted");
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

  /* ---------- Modal ---------- */
  const showNew = () => { $("new-modal").classList.remove("hidden"); $("nt-title").focus(); };
  const closeNew = () => { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-error").textContent = ""; };

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
    $("new-ticket-btn").onclick = showNew;
    $("modal-close").onclick = closeNew; $("nt-cancel").onclick = closeNew;
    $("back-btn").onclick = () => { showQueue(); };

    // sidebar nav
    document.querySelectorAll(".nav-item").forEach(item => {
      item.onclick = () => {
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        item.classList.add("active");
        filter = item.dataset.filter;
        showQueue(); renderQueue();
      };
    });
    // toolbar
    $("search").oninput = renderQueue;
    $("f-priority").onchange = renderQueue;
    $("f-client").onchange = renderQueue;

    // detail controls
    $("d-status").onchange = e => patch("status", e.target.value);
    $("d-priority").onchange = e => patch("priority", e.target.value);
    $("d-assignee").onchange = e => { if (e.target.value) patch("assigned_to_id", parseInt(e.target.value)); };

    $("reply-form").onsubmit = async e => {
      e.preventDefault(); const b = $("reply-body").value.trim(); if (!b) return;
      const internal = $("reply-internal").checked;
      $("reply-body").value = ""; $("reply-internal").checked = false;
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
      if (!clientId) { $("nt-error").textContent = "Please choose a company"; return; }
      const payload = {
        title: $("nt-title").value.trim(),
        description: $("nt-desc").value.trim() || null,
        category: $("nt-category").value || null,
        priority: $("nt-priority").value,
        client_id: parseInt(clientId),
      };
      const a = $("nt-assignee").value; if (a) payload.assigned_to_id = parseInt(a);
      try { await createTicket(payload); } catch (err) { $("nt-error").textContent = err.message; }
    };

    if (token) { try { await enter(); } catch (e) { logout(); } }
    else showLogin();
  }
  async function enter() { await loadAll(); showApp(); showQueue(); }

  return { start };
})();

document.addEventListener("DOMContentLoaded", Staff.start);

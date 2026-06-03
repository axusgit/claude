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
    $("d-board").value = current.board_id || "";
    $("p-company").textContent = clientMap[current.client_id] || "—";
    $("p-category").textContent = current.category || "Uncategorized";
    $("p-type").textContent = current.ticket_type === "sow" ? "SOW / Project" : "Standard";
    $("p-hours").textContent = (current.total_hours || 0) + " h";
    $("p-created").textContent = fmtDate(current.created_at);
    // resolve reporting contact name
    if (current.contact_id) {
      try { const cs = await api(`/api/clients/${current.client_id}/contacts`); const ct = cs.find(x => x.id === current.contact_id); $("p-contact").textContent = ct ? ct.full_name : "—"; }
      catch (e) { $("p-contact").textContent = "—"; }
    } else { $("p-contact").textContent = "—"; }
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
      .filter(c => !q || `${c.company_name} ${c.contact_name} ${c.email}`.toLowerCase().includes(q))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
    $("cust-summary").textContent = `${clientsData.length} customer${clientsData.length === 1 ? "" : "s"}`;
    const tbody = $("customer-rows"); tbody.innerHTML = "";
    $("customers-empty").classList.toggle("hidden", rows.length > 0);
    for (const c of rows) {
      const tcount = tickets.filter(t => t.client_id === c.id).length;
      const tr = document.createElement("tr");
      tr.onclick = () => openCustomer(c.id);
      tr.innerHTML = `
        <td class="cell-subject">${esc(c.company_name)}</td>
        <td>${esc(c.contact_name)}</td>
        <td class="cell-muted">${esc(c.email)}</td>
        <td class="cell-muted">${esc(c.phone || "—")}</td>
        <td>${tcount}</td>
        <td><span class="badge ${c.is_active ? "resolved" : "closed"}">${c.is_active ? "Active" : "Inactive"}</span></td>
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
    $("cd-contact").textContent = c.contact_name;
    $("cd-email").textContent = c.email;
    $("cd-phone").textContent = c.phone || "—";
    if (c.website) {
      const url = /^https?:\/\//i.test(c.website) ? c.website : "https://" + c.website;
      $("cd-website").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--orange)">${esc(c.website)}</a>`;
    } else { $("cd-website").textContent = "—"; }
    $("cd-address").textContent = c.address || "—";
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
    const [users, contacts] = await Promise.all([
      api(`/api/clients/${id}/portal-users`),
      api(`/api/clients/${id}/contacts`),
    ]);
    $("cd-users").innerHTML = users.length
      ? users.map(u => `<div class="time-item"><span>${esc(u.full_name)}<br><span class="cell-muted">${esc(u.email)}</span></span></div>`).join("")
      : `<div class="muted">No portal logins yet.</div>`;
    renderContacts(contacts);
  }

  let contactEditId = null;
  function renderContacts(contacts) {
    const box = $("cd-contacts"); box.innerHTML = "";
    if (!contacts.length) { box.innerHTML = `<div class="muted">No contacts yet.</div>`; return; }
    contacts.forEach(c => {
      const row = document.createElement("div");
      row.className = "contact-item";
      row.innerHTML = `<div class="contact-av">${initials(c.full_name)}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(c.full_name)}${c.title ? ` · <span class="cell-muted" style="font-weight:500">${esc(c.title)}</span>` : ""}</div>
          <div class="contact-meta">${esc(c.email || "")}${c.email && c.phone ? " · " : ""}${esc(c.phone || "")}</div>
        </div>`;
      row.onclick = () => showContactModal(c);
      box.appendChild(row);
    });
  }
  function showContactModal(c) {
    $("co-error").textContent = "";
    if (c) {
      $("contact-modal-title").textContent = "Edit Contact";
      $("co-name").value = c.full_name; $("co-title").value = c.title || "";
      $("co-email").value = c.email || ""; $("co-phone").value = c.phone || "";
      contactEditId = c.id; $("co-delete").style.display = "";
    } else {
      $("contact-modal-title").textContent = "Add Contact";
      $("contact-form").reset(); contactEditId = null; $("co-delete").style.display = "none";
    }
    $("contact-modal").classList.remove("hidden");
  }
  const closeContactModal = () => $("contact-modal").classList.add("hidden");
  async function saveContact() {
    const payload = {
      full_name: $("co-name").value.trim(),
      title: $("co-title").value.trim() || null,
      email: $("co-email").value.trim() || null,
      phone: $("co-phone").value.trim() || null,
    };
    const cid = currentCustomer.id;
    if (contactEditId) await api(`/api/clients/${cid}/contacts/${contactEditId}`, { method: "PUT", body: payload });
    else await api(`/api/clients/${cid}/contacts`, { method: "POST", body: payload });
    closeContactModal(); await openCustomer(cid); toast("Contact saved");
  }
  async function deleteContact() {
    if (!contactEditId) return;
    await api(`/api/clients/${currentCustomer.id}/contacts/${contactEditId}`, { method: "DELETE" });
    closeContactModal(); await openCustomer(currentCustomer.id); toast("Contact removed");
  }

  function showCustModal(c) {
    $("cf-error").textContent = "";
    if (c) {
      $("cust-modal-title").textContent = "Edit Customer";
      $("cf-company").value = c.company_name; $("cf-contact").value = c.contact_name;
      $("cf-email").value = c.email; $("cf-phone").value = c.phone || "";
      $("cf-website").value = c.website || "";
      $("cf-address").value = c.address || ""; $("cf-active").value = String(c.is_active);
      custEditId = c.id;
    } else {
      $("cust-modal-title").textContent = "New Customer";
      $("cust-form").reset(); custEditId = null;
    }
    $("cust-modal").classList.remove("hidden");
  }
  const closeCustModal = () => $("cust-modal").classList.add("hidden");

  async function saveCustomer() {
    const payload = {
      company_name: $("cf-company").value.trim(),
      contact_name: $("cf-contact").value.trim(),
      email: $("cf-email").value.trim(),
      phone: $("cf-phone").value.trim() || null,
      website: $("cf-website").value.trim() || null,
      address: $("cf-address").value.trim() || null,
      is_active: $("cf-active").value === "true",
    };
    if (custEditId) await api(`/api/clients/${custEditId}`, { method: "PUT", body: payload });
    else await api("/api/clients/", { method: "POST", body: payload });
    closeCustModal();
    await refreshClients();
    renderCustomers();
    if (custEditId && currentCustomer && currentCustomer.id === custEditId) await openCustomer(custEditId);
    toast("Customer saved");
  }

  async function addPortalUser() {
    await api(`/api/clients/${currentCustomer.id}/portal-users`, {
      method: "POST",
      body: { full_name: $("pu-name").value.trim(), email: $("pu-email").value.trim(), password: $("pu-password").value },
    });
    $("puser-modal").classList.add("hidden"); $("pu-form").reset();
    await openCustomer(currentCustomer.id);
    toast("Portal login created");
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
        <td><span class="badge ${u.is_active ? "resolved" : "closed"}">${u.is_active ? "Active" : "Inactive"}</span></td>`;
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

  /* ---------- Modal ---------- */
  const showNew = () => { $("new-modal").classList.remove("hidden"); $("nt-contact").innerHTML = `<option value="">— None —</option>`; $("nt-title").focus(); };
  const closeNew = () => { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-error").textContent = ""; };

  async function loadContactsInto(selectEl, clientId) {
    selectEl.innerHTML = `<option value="">— None —</option>`;
    if (!clientId) return;
    try {
      const contacts = await api(`/api/clients/${clientId}/contacts`);
      contacts.forEach(c => {
        const o = document.createElement("option");
        o.value = c.id; o.textContent = c.full_name + (c.title ? ` (${c.title})` : "");
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
    $("new-ticket-btn").onclick = showNew;
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

    // contacts
    $("cd-addcontact-btn").onclick = () => showContactModal(null);
    $("co-close").onclick = closeContactModal; $("co-cancel").onclick = closeContactModal;
    $("contact-form").onsubmit = async e => { e.preventDefault(); $("co-error").textContent = ""; try { await saveContact(); } catch (err) { $("co-error").textContent = err.message; } };
    $("co-delete").onclick = async () => { try { await deleteContact(); } catch (err) { $("co-error").textContent = err.message; } };

    // ticket form: load contacts when company changes
    $("nt-client").onchange = () => loadContactsInto($("nt-contact"), $("nt-client").value);

    // users
    $("user-search").oninput = renderUsers;
    $("uf-role").onchange = renderUsers;
    $("new-user-btn").onclick = () => showUserModal(null);
    $("um-close").onclick = closeUserModal; $("uf-cancel").onclick = closeUserModal;
    $("user-form").onsubmit = async e => { e.preventDefault(); $("uf-error").textContent = ""; try { await saveUser(); } catch (err) { $("uf-error").textContent = err.message; } };

    // sidebar nav (ticket queues + manage sections)
    document.querySelectorAll(".nav-item").forEach(item => {
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

    // detail controls
    $("d-status").onchange = e => patch("status", e.target.value);
    $("d-priority").onchange = e => patch("priority", e.target.value);
    $("d-assignee").onchange = e => { if (e.target.value) patch("assigned_to_id", parseInt(e.target.value)); };
    $("d-board").onchange = e => patch("board_id", e.target.value ? parseInt(e.target.value) : null);

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
      const ct = $("nt-contact").value; if (ct) payload.contact_id = parseInt(ct);
      const bd = $("nt-board").value; if (bd) payload.board_id = parseInt(bd);
      try { await createTicket(payload); } catch (err) { $("nt-error").textContent = err.message; }
    };

    // Try an existing session (stored JWT locally, or gateway identity in
    // central mode); fall back to the login screen.
    try { await enter(); } catch (e) { showLogin(); }
  }
  async function enter() { await loadAll(); showApp(); showQueue(); }

  return { start };
})();

document.addEventListener("DOMContentLoaded", Staff.start);

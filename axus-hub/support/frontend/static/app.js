/* ===================== Axus Hub — Client Portal ===================== */
const App = (() => {
  const TOKEN_KEY = "axus-token";
  const THEME_KEY = "axus-theme";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let me = null;            // { id, full_name, role }
  let currentTicket = null; // id of open ticket

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const icon = theme === "dark" ? "☀️" : "🌙";
    document.querySelectorAll(".theme-icon").forEach(el => el.textContent = icon);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  /* ---------- API ---------- */
  async function api(path, { method = "GET", body, form } = {}) {
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    let payload;
    if (form) { payload = form; }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(path, { method, headers, body: payload });
    if (res.status === 401) { logout(); throw new Error("Session expired"); }
    if (!res.ok) {
      let detail = res.statusText;
      try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : detail; } catch (e) {}
      throw new Error(detail);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  /* ---------- Helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = n => (n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function fileSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  /* ---------- View switching ---------- */
  function showLogin() { $("login-view").classList.remove("hidden"); $("app-view").classList.add("hidden"); }
  function showApp()   { $("login-view").classList.add("hidden");    $("app-view").classList.remove("hidden"); }
  function showList()  { $("list-view").classList.remove("hidden");  $("detail-view").classList.add("hidden"); }
  function showDetail(){ $("list-view").classList.add("hidden");     $("detail-view").classList.remove("hidden"); }

  /* ---------- Auth ---------- */
  async function login(email, password) {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      let msg = "Invalid email or password";
      try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch (e) {}
      throw new Error(msg);
    }
    const data = await res.json();
    token = data.access_token;
    localStorage.setItem(TOKEN_KEY, token);
  }
  function logout() {
    token = null; me = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  async function loadIdentity() {
    me = await api("/api/auth/me");                 // id, full_name, role
    const portal = await api("/api/portal/me");     // company (also enforces client-only)
    $("who-name").textContent = me.full_name;
    $("who-company").textContent = portal.company || "";
  }

  /* ---------- Tickets list ---------- */
  async function loadTickets() {
    const tickets = await api("/api/portal/tickets");
    const list = $("ticket-list"), empty = $("list-empty");
    list.innerHTML = "";
    if (!tickets.length) {
      empty.classList.remove("hidden"); list.classList.add("hidden");
      $("list-summary").textContent = "";
      return;
    }
    empty.classList.add("hidden"); list.classList.remove("hidden");
    const open = tickets.filter(t => t.status !== "closed").length;
    $("list-summary").textContent = `${tickets.length} total · ${open} open`;
    for (const t of tickets) {
      const el = document.createElement("div");
      el.className = "ticket-card";
      el.onclick = () => openTicket(t.id);
      el.innerHTML = `
        <div class="tc-prio-bar prio ${t.priority}" style="background:currentColor"></div>
        <div class="tc-body">
          <div class="tc-title">${esc(t.title)}</div>
          <div class="tc-sub">
            <span class="tc-ref">${esc(t.reference || "")}</span>
            ${t.category ? `<span>${esc(t.category)}</span>` : ""}
            <span>Updated ${fmtDate(t.updated_at || t.created_at)}</span>
          </div>
        </div>
        <span class="badge ${t.status}">${t.status.replace("_", " ")}</span>`;
      list.appendChild(el);
    }
  }

  /* ---------- Ticket detail ---------- */
  async function openTicket(id) {
    currentTicket = id;
    const t = await api(`/api/portal/tickets/${id}`);
    $("d-ref").textContent = t.reference || "";
    $("d-status").className = "badge " + t.status;
    $("d-status").textContent = t.status.replace("_", " ");
    $("d-priority").className = "prio " + t.priority;
    $("d-priority").textContent = t.priority;
    $("d-title").textContent = t.title;
    $("d-desc").textContent = t.description || "No description provided.";
    $("d-category").textContent = t.category || "Uncategorized";
    $("d-created").textContent = "Opened " + fmtDate(t.created_at);
    showDetail();
    await Promise.all([loadThread(id), loadAttachments(id)]);
  }

  async function loadThread(id) {
    const comments = await api(`/api/portal/tickets/${id}/comments`);
    const thread = $("thread");
    if (!comments.length) { thread.innerHTML = `<div class="thread-empty">No replies yet — our team will respond here.</div>`; return; }
    thread.innerHTML = comments.map(c => {
      const mine = me && c.author_id === me.id;
      const who = mine ? "You" : "Axus Support";
      return `<div class="msg ${mine ? "me" : "them"}">
        <div class="msg-avatar">${mine ? initials(me.full_name) : "AX"}</div>
        <div class="msg-bubble">
          <div class="msg-meta">${who} · ${fmtDate(c.created_at)}</div>
          <div class="msg-body">${esc(c.body)}</div>
        </div>
      </div>`;
    }).join("");
  }

  async function loadAttachments(id) {
    const files = await api(`/api/portal/tickets/${id}/attachments`);
    const box = $("attach-list");
    if (!files.length) { box.innerHTML = `<div class="muted">No files attached.</div>`; return; }
    box.innerHTML = files.map(f => `
      <div class="attach-item">
        <span>📄</span>
        <a href="#" onclick="App.download(${f.id}, '${esc(f.filename).replace(/'/g, "")}');return false;">${esc(f.filename)}</a>
        <span class="attach-size">${fileSize(f.size)}</span>
      </div>`).join("");
  }

  async function download(attId, filename) {
    const res = await api(`/api/portal/tickets/${currentTicket}/attachments/${attId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Actions ---------- */
  async function reply(bodyText) {
    await api(`/api/portal/tickets/${currentTicket}/comments`, { method: "POST", body: { body: bodyText } });
    await loadThread(currentTicket);
    toast("Reply sent");
  }
  async function uploadFile(file) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/portal/tickets/${currentTicket}/attachments`, { method: "POST", form: fd });
    await loadAttachments(currentTicket);
    toast("File uploaded");
  }
  async function createTicket(payload) {
    const t = await api("/api/portal/tickets", { method: "POST", body: payload });
    closeNew();
    await loadTickets();
    openTicket(t.id);
    toast("Ticket " + (t.reference || "") + " submitted");
  }

  /* ---------- Modal ---------- */
  function showNew() { $("new-modal").classList.remove("hidden"); $("nt-title").focus(); }
  function closeNew() { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-error").textContent = ""; }

  /* ---------- Init / wiring ---------- */
  async function start() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    $("theme-toggle-login").onclick = toggleTheme;

    $("login-form").onsubmit = async e => {
      e.preventDefault();
      $("login-error").textContent = "";
      $("login-btn").disabled = true; $("login-btn").textContent = "Signing in…";
      try {
        await login($("login-email").value.trim(), $("login-password").value);
        await enterApp();
      } catch (err) {
        $("login-error").textContent = err.message;
      } finally {
        $("login-btn").disabled = false; $("login-btn").textContent = "Sign in";
      }
    };
    $("logout-btn").onclick = logout;
    $("new-ticket-btn").onclick = showNew;
    $("modal-close").onclick = closeNew;
    $("nt-cancel").onclick = closeNew;
    $("back-btn").onclick = () => { showList(); loadTickets(); };

    $("reply-form").onsubmit = async e => {
      e.preventDefault();
      const body = $("reply-body").value.trim(); if (!body) return;
      $("reply-body").value = "";
      try { await reply(body); } catch (err) { toast(err.message); }
    };
    $("attach-input").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await uploadFile(f); } catch (err) { toast(err.message); }
      e.target.value = "";
    };
    $("new-form").onsubmit = async e => {
      e.preventDefault(); $("nt-error").textContent = "";
      try {
        await createTicket({
          title: $("nt-title").value.trim(),
          description: $("nt-desc").value.trim() || null,
          category: $("nt-category").value || null,
          priority: $("nt-priority").value,
        });
      } catch (err) { $("nt-error").textContent = err.message; }
    };

    // Try an existing session (stored JWT locally, or gateway identity in
    // central mode); fall back to the login screen.
    try { await enterApp(); } catch (e) { showLogin(); }
  }

  async function enterApp() {
    await loadIdentity();
    showApp(); showList();
    await loadTickets();
  }

  return { start, showNew, download };
})();

document.addEventListener("DOMContentLoaded", App.start);

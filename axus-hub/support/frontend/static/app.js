/* ===================== Axus Hub — Client Portal ===================== */
const App = (() => {
  const TOKEN_KEY = "axus-token";
  const THEME_KEY = "axus-theme";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let me = null;            // { id, full_name, role }
  let currentTicket = null; // id of open ticket
  let currentClosed = false; // whether the open ticket is closed (read-only for clients)
  const PRIO_LABEL = { low: "Low", medium: "Normal", high: "High", critical: "Critical" };
  const prioLabel = p => PRIO_LABEL[p] || (p || "");
  // Plain-language meaning of each priority, shown as a tooltip on the badge.
  const PRIO_MEANING = {
    critical: "Critical — a service or system is down or severely impacted; needs immediate attention.",
    high: "High — significant impact to your operations; prioritized ahead of routine work.",
    medium: "Normal — a standard request handled in the normal course of business (the default priority).",
    low: "Low — a minor or non-urgent request scheduled after higher-priority work.",
  };
  const PRIO_ORDER = ["low", "medium", "high", "critical"];   // ascending
  // Populate the escalate dropdown with ONLY priorities higher than the current one
  // (clients can raise, never lower). Hidden when closed or already at the top.
  function fillRaisePriority(t) {
    const sel = $("d-raise-prio");
    const cur = PRIO_ORDER.indexOf(t.priority);
    const higher = (t.status === "closed" || cur < 0) ? [] : PRIO_ORDER.slice(cur + 1);
    if (!higher.length) { sel.hidden = true; sel.innerHTML = ""; return; }
    sel.innerHTML = `<option value="">Raise priority</option>` +
      higher.map(p => `<option value="${p}">${prioLabel(p)}</option>`).join("");
    sel.hidden = false;
  }
  const statusLabel = s => (s || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  // File types a customer may attach (must match the server-side whitelist).
  const ALLOWED_EXTS = new Set([
    ".doc", ".pdf", ".jpg", ".jpeg", ".gif", ".png", ".xls", ".docx", ".xlsx",
    ".txt", ".pcapng", ".eml", ".pcap", ".wav", ".csv", ".mp4", ".mp3", ".heic",
  ]);
  const extOf = name => { const i = (name || "").lastIndexOf("."); return i < 0 ? "" : name.slice(i).toLowerCase(); };

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

  /* ---------- Auth (passwordless magic-link) ---------- */
  async function requestMagicLink(email) {
    // Always neutral server-side (no account enumeration); we ignore the body.
    await fetch("/api/portal/auth/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }
  async function verifyMagic(rawToken) {
    const res = await fetch("/api/portal/auth/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
    });
    if (!res.ok) {
      let msg = "This sign-in link is invalid or has expired. Please request a new one.";
      try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch (e) {}
      throw new Error(msg);
    }
    const data = await res.json();
    token = data.access_token;                    // 30-day portal session
    localStorage.setItem(TOKEN_KEY, token);
  }
  function logout() {
    token = null; me = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  async function loadIdentity() {
    const portal = await api("/api/portal/me");     // id, role, full_name, company (JWT-only)
    me = { id: portal.id, full_name: portal.full_name, role: portal.role };
    $("who-name").textContent = portal.full_name || portal.email;
    $("who-company").textContent = portal.company || "";
  }

  /* ---------- Tickets list ---------- */
  let ticketsData = [];   // all of this client's tickets (filtered client-side)
  async function loadTickets() {
    ticketsData = await api("/api/portal/tickets");
    renderTickets();
  }
  function renderTickets() {
    const list = $("ticket-list"), empty = $("list-empty");
    if (!ticketsData.length) {
      empty.classList.remove("hidden"); list.classList.add("hidden");
      $("list-summary").textContent = "";
      return;
    }
    empty.classList.add("hidden"); list.classList.remove("hidden");
    const q = ($("pf-search").value || "").trim().toLowerCase();
    const st = $("pf-status").value;
    const range = $("pf-range").value;
    let from = null, to = null;
    if (range === "custom") {
      if ($("pf-from").value) from = new Date($("pf-from").value + "T00:00:00");
      if ($("pf-to").value) to = new Date($("pf-to").value + "T23:59:59");
    } else if (range) {
      from = new Date(Date.now() - parseInt(range, 10) * 86400000);
    }
    const rows = ticketsData.filter(t => {
      if (st === "open" && t.status === "closed") return false;
      if (st === "closed" && t.status !== "closed") return false;
      const created = new Date(t.created_at);
      if (from && created < from) return false;
      if (to && created > to) return false;
      if (q) {
        const hay = `${t.reference || ""} ${t.title || ""} ${t.category || ""} ${t.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const openCount = ticketsData.filter(t => t.status !== "closed").length;
    const closedCount = ticketsData.length - openCount;
    $("list-summary").textContent = `Showing ${rows.length} of ${ticketsData.length}`;
    const hs = $("hero-stats");
    if (hs) hs.innerHTML =
      `<div class="stat-pill is-open"><span class="stat-n">${openCount}</span><span class="stat-l">Open</span></div>` +
      `<div class="stat-pill"><span class="stat-n">${closedCount}</span><span class="stat-l">Closed</span></div>` +
      `<div class="stat-pill"><span class="stat-n">${ticketsData.length}</span><span class="stat-l">Total</span></div>`;
    if (!rows.length) {
      list.innerHTML = `<div class="muted" style="padding:24px 4px">No tickets match your filters.</div>`;
      return;
    }
    list.innerHTML = rows.map(t => `
      <div class="ticket-card" data-id="${t.id}">
        <span class="tc-glow"></span>
        <div class="tc-prio-bar prio ${t.priority}" style="background:currentColor"></div>
        <div class="tc-body">
          <div class="tc-title">${esc(t.title)}</div>
          <div class="tc-sub">
            <span class="tc-ref">${esc(t.reference || "")}</span>
            ${t.category ? `<span>${esc(t.category)}</span>` : ""}
            <span>Updated ${fmtDate(t.updated_at || t.created_at)}</span>
          </div>
        </div>
        <span class="badge ${t.status}">${statusLabel(t.status)}</span>
      </div>`).join("");
    list.querySelectorAll(".ticket-card").forEach(el => el.onclick = () => openTicket(parseInt(el.dataset.id, 10)));
  }

  /* ---------- Ticket detail ---------- */
  async function openTicket(id) {
    currentTicket = id;
    const t = await api(`/api/portal/tickets/${id}`);
    $("d-ref").textContent = t.reference || "";
    $("d-status").className = "badge " + t.status;
    $("d-status").textContent = statusLabel(t.status);
    $("d-priority").className = "prio-badge " + t.priority;
    $("d-priority").textContent = prioLabel(t.priority);
    $("d-priority").title = PRIO_MEANING[t.priority] || "";
    fillRaisePriority(t);
    $("d-title").textContent = t.title;
    $("d-desc").textContent = t.description || "No description provided.";
    $("d-category").textContent = t.category || "Uncategorized";
    $("d-created").textContent = "Opened " + fmtDate(t.created_at);
    // Closed cases are fully read-only for clients: no replies, no close, and no
    // editing of participants or attachments (they stay visible, just not editable).
    const closed = t.status === "closed";
    currentClosed = closed;
    $("reply-close").checked = false;
    $("reply-form").classList.toggle("hidden", closed);
    $("reply-closed-note").classList.toggle("hidden", !closed);
    $("attach-upload-box").classList.toggle("hidden", closed);
    $("participant-email-row").classList.toggle("hidden", closed);
    $("participant-hint").classList.toggle("hidden", closed);
    showDetail();
    await Promise.all([loadThread(id), loadAttachments(id), loadParticipants(id)]);
  }

  async function loadParticipants(id) {
    const [people, orgUsers] = await Promise.all([
      api(`/api/portal/tickets/${id}/participants`),
      api(`/api/portal/org-users`),
    ]);
    const box = $("participant-list");
    box.innerHTML = people.map(p => {
      // On a closed case participants are read-only — no remove (✕) control.
      const tag = (p.is_reporter || currentClosed) ? `<span class="attach-size">${p.is_reporter ? "opened this" : ""}</span>`
        : `<a href="#" class="part-remove" data-uid="${p.id}" title="Remove">✕</a>`;
      return `<div class="attach-item"><span>👤</span><span style="flex:1">${esc(p.full_name)}</span>${tag}</div>`;
    }).join("");
    box.querySelectorAll(".part-remove").forEach(a => a.onclick = ev => {
      ev.preventDefault(); removeParticipant(parseInt(a.dataset.uid));
    });
    $("part-count").textContent = people.length ? `(${people.length})` : "";
    // fill the "add a colleague" picker with org users not already on the ticket
    const onTicket = new Set(people.map(p => p.id));
    const sel = $("participant-select");
    const avail = orgUsers.filter(u => !onTicket.has(u.id));
    sel.innerHTML = `<option value="">Add a colleague…</option>` +
      avail.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join("");
    // Hide the add-colleague row when the case is closed or nobody's left to add.
    $("participant-org-row").style.display = (!currentClosed && avail.length) ? "" : "none";
  }

  async function addParticipant() {
    const uid = $("participant-select").value;
    if (!uid) return;
    try {
      await api(`/api/portal/tickets/${currentTicket}/participants`, { method: "POST", body: { user_id: parseInt(uid) } });
      await loadParticipants(currentTicket);
      toast("Participant added");
    } catch (err) { toast(err.message); }
  }

  async function addParticipantEmail() {
    const email = $("participant-email").value.trim();
    if (!email) return;
    try {
      await api(`/api/portal/tickets/${currentTicket}/participants`, { method: "POST", body: { email } });
      $("participant-email").value = "";
      await loadParticipants(currentTicket);
      toast("Participant added");
    } catch (err) { toast(err.message); }
  }

  async function removeParticipant(uid) {
    try {
      await api(`/api/portal/tickets/${currentTicket}/participants/${uid}`, { method: "DELETE" });
      await loadParticipants(currentTicket);
      toast("Participant removed");
    } catch (err) { toast(err.message); }
  }

  async function loadThread(id) {
    const comments = await api(`/api/portal/tickets/${id}/comments`);
    const thread = $("thread");
    if (!comments.length) { thread.innerHTML = `<div class="thread-empty">No replies yet — our team will respond here.</div>`; return; }
    // newest reply first, right under the ticket description
    thread.innerHTML = comments.slice().reverse().map(c => {
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
  async function reply(bodyText, files, close) {
    await api(`/api/portal/tickets/${currentTicket}/comments`, { method: "POST", body: { body: bodyText || null, close: !!close } });
    for (const f of (files || [])) {
      const fd = new FormData(); fd.append("file", f);
      try { await api(`/api/portal/tickets/${currentTicket}/attachments`, { method: "POST", form: fd }); }
      catch (e) { toast(`Couldn't attach ${f.name}: ${e.message}`); }
    }
    if (close) { await openTicket(currentTicket); toast("Case closed"); }
    else { await Promise.all([loadThread(currentTicket), loadAttachments(currentTicket)]); toast("Posted"); }
  }
  async function uploadFile(file) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/portal/tickets/${currentTicket}/attachments`, { method: "POST", form: fd });
    await loadAttachments(currentTicket);
    toast("File uploaded");
  }
  async function createTicket(payload, files) {
    const t = await api("/api/portal/tickets", { method: "POST", body: payload });
    // Attach any selected files to the new ticket (best-effort, one at a time).
    let failed = [];
    for (const f of (files || [])) {
      const fd = new FormData(); fd.append("file", f);
      try { await api(`/api/portal/tickets/${t.id}/attachments`, { method: "POST", form: fd }); }
      catch (err) { failed.push(f.name); }
    }
    closeNew();
    await loadTickets();
    openTicket(t.id);
    toast(failed.length
      ? `Ticket ${t.reference || ""} submitted; couldn't attach: ${failed.join(", ")}`
      : "Ticket " + (t.reference || "") + " submitted");
  }

  function renderSelectedFiles() {
    const box = $("nt-file-list");
    const files = Array.from($("nt-files").files || []);
    if (!files.length) { box.innerHTML = ""; return; }
    box.innerHTML = files.map(f => {
      const ok = ALLOWED_EXTS.has(extOf(f.name));
      return `<div class="nt-file${ok ? "" : " nt-file-bad"}">${ok ? "📎" : "⛔"} ${f.name} <span class="attach-size">${fileSize(f.size)}</span>${ok ? "" : " — not an accepted format"}</div>`;
    }).join("");
  }

  /* ---------- Modal ---------- */
  function showNew() { $("new-modal").classList.remove("hidden"); $("nt-title").focus(); }
  function closeNew() { $("new-modal").classList.add("hidden"); $("new-form").reset(); $("nt-file-list").innerHTML = ""; $("nt-error").textContent = ""; }

  /* ---------- Init / wiring ---------- */
  async function start() {
    document.querySelectorAll(".foot-year").forEach(el => el.textContent = new Date().getFullYear());
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    $("theme-toggle-login").onclick = toggleTheme;

    $("login-form").onsubmit = async e => {
      e.preventDefault();
      $("login-error").textContent = "";
      const email = $("login-email").value.trim();
      if (!email) return;
      $("login-btn").disabled = true; $("login-btn").textContent = "Sending…";
      try {
        await requestMagicLink(email);
        $("login-form").classList.add("hidden");
        $("login-sent").classList.remove("hidden");
      } catch (err) {
        $("login-error").textContent = "Something went wrong. Please try again.";
      } finally {
        $("login-btn").disabled = false; $("login-btn").textContent = "Email me a sign-in link";
      }
    };
    $("login-again").onclick = () => {
      $("login-sent").classList.add("hidden");
      $("login-form").classList.remove("hidden");
      $("login-email").value = ""; $("login-email").focus();
    };
    $("logout-btn").onclick = logout;
    $("new-ticket-btn").onclick = showNew;
    $("pf-search").oninput = renderTickets;
    $("pf-status").onchange = renderTickets;
    $("pf-range").onchange = () => {
      const custom = $("pf-range").value === "custom";
      $("pf-from").hidden = !custom; $("pf-to").hidden = !custom;
      renderTickets();
    };
    $("pf-from").onchange = renderTickets;
    $("pf-to").onchange = renderTickets;
    $("modal-close").onclick = closeNew;
    $("nt-cancel").onclick = closeNew;
    $("back-btn").onclick = () => { showList(); loadTickets(); };
    $("d-raise-prio").onchange = async e => {
      const p = e.target.value; e.target.value = "";
      if (!p) return;
      if (!confirm(`Raise this ticket's priority to ${prioLabel(p)}? Priority can be raised but not lowered from the portal.`)) return;
      try {
        await api(`/api/portal/tickets/${currentTicket}/priority`, { method: "PATCH", body: { priority: p } });
        await openTicket(currentTicket);
        toast(`Priority raised to ${prioLabel(p)}`);
      } catch (err) { toast(err.message); }
    };
    $("participant-add-btn").onclick = addParticipant;
    $("participant-email-btn").onclick = addParticipantEmail;
    $("participant-email").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addParticipantEmail(); } };

    $("reply-files").onchange = () => {
      const n = $("reply-files").files.length;
      $("reply-files-label").textContent = n ? `${n} file${n > 1 ? "s" : ""}` : "Attach";
    };
    $("reply-form").onsubmit = async e => {
      e.preventDefault();
      const body = $("reply-body").value.trim();
      const close = $("reply-close").checked;
      if (!body) { toast(close ? "Please add a note in the Conversation field before closing the case." : "Please enter your message before posting."); return; }
      const files = Array.from($("reply-files").files || []);
      $("reply-body").value = ""; $("reply-close").checked = false;
      $("reply-files").value = ""; $("reply-files-label").textContent = "Attach";
      try { await reply(body, files, close); } catch (err) { toast(err.message); }
    };
    $("attach-input").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await uploadFile(f); } catch (err) { toast(err.message); }
      e.target.value = "";
    };
    $("nt-files").onchange = renderSelectedFiles;
    $("new-form").onsubmit = async e => {
      e.preventDefault(); $("nt-error").textContent = "";
      const files = Array.from($("nt-files").files || []);
      const bad = files.filter(f => !ALLOWED_EXTS.has(extOf(f.name)));
      if (bad.length) {
        $("nt-error").textContent = "These files aren't an accepted format: " + bad.map(f => f.name).join(", ");
        return;
      }
      try {
        await createTicket({
          title: $("nt-title").value.trim(),
          description: $("nt-desc").value.trim() || null,
          category: $("nt-category").value || null,
          priority: $("nt-priority").value,
        }, files);
      } catch (err) { $("nt-error").textContent = err.message; }
    };

    // If the user arrived from an emailed magic link, redeem it (single-use),
    // then strip the token from the URL so it isn't re-used or bookmarked.
    const magic = new URLSearchParams(location.search).get("login");
    if (magic) {
      try {
        await verifyMagic(magic);
        history.replaceState({}, "", location.pathname);
      } catch (err) {
        history.replaceState({}, "", location.pathname);
        showLogin();
        $("login-error").textContent = err.message;
        return;
      }
    }
    // Otherwise use the stored 30-day session; fall back to the login screen.
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

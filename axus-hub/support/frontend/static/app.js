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
    // Always show activity times in Axus's timezone (US Eastern, EDT/EST), not the
    // viewer's local zone. Treat timezone-naive values (no Z / offset) as UTC.
    let iso = String(s);
    if (/T\d{2}:\d{2}/.test(iso) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York", timeZoneName: "short"
    });
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
  async function passwordLogin(email, password) {
    const res = await fetch("/api/portal/auth/password-login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Sign-in failed. Please try again.");
    token = data.access_token;                    // 30-day portal session
    localStorage.setItem(TOKEN_KEY, token);
    return data;   // { must_change_password, expiry_warning }
  }
  async function setPassword(newPassword, currentPassword) {
    const res = await fetch("/api/portal/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ new_password: newPassword, current_password: currentPassword || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't save your password.");
    return data;
  }
  // Show one of the login card's panels: "link" | "pw" | "setpw" | "sent".
  function loginPanel(which) {
    ["login-form", "login-pw-form", "login-setpw-form", "login-sent"].forEach(id => {
      $(id).classList.toggle("hidden", id !== ({
        link: "login-form", pw: "login-pw-form", setpw: "login-setpw-form", sent: "login-sent",
      })[which]);
    });
  }
  // Present the forced create/change-password screen. `forced` hides the current-password field.
  function showSetPassword({ forced, title, sub }) {
    showLogin();
    loginPanel("setpw");
    $("setpw-title").textContent = title || (forced ? "Create your password" : "Change your password");
    $("setpw-sub").textContent = sub || (forced
      ? "Choose a password to finish signing in." : "Enter your current password and a new one.");
    $("setpw-cur-label").classList.toggle("hidden", !!forced);
    $("setpw-cur").value = ""; $("setpw-new").value = ""; $("setpw-confirm").value = "";
    $("setpw-error").textContent = "";
    $("login-setpw-form").dataset.forced = forced ? "1" : "";
  }
  function logout() {
    token = null; me = null;
    localStorage.removeItem(TOKEN_KEY);
    loginPanel("link");
    showLogin();
  }

  async function loadIdentity() {
    const portal = await api("/api/portal/me");     // id, role, full_name, company (JWT-only)
    me = { id: portal.id, full_name: portal.full_name, role: portal.role,
           must_change_password: portal.must_change_password,
           password_expiry_warning: portal.password_expiry_warning,
           has_password: portal.has_password,
           password_login_active: portal.password_login_active };
    // "Change password" is only meaningful once the user has a password they can
    // sign in with (staff must enable password login + set an initial one first).
    const chBtn = $("change-pw-btn");
    if (chBtn) chBtn.hidden = !(portal.password_login_active && portal.has_password);
    $("who-name").textContent = portal.full_name || portal.email;
    $("who-company").textContent = portal.company || "";
    const phoneEl = $("who-phone");
    if (portal.phone) { phoneEl.textContent = portal.phone; phoneEl.hidden = false; }
    else { phoneEl.textContent = ""; phoneEl.hidden = true; }
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
    $("reply-body").style.height = "";   // back to the default height on every ticket open (undo any drag-resize)
    $("reply-files").value = ""; renderReplyFiles();   // clear any files staged on the previous ticket
    $("reply-form").classList.toggle("hidden", closed);
    $("reply-closed-note").classList.toggle("hidden", !closed);
    $("participant-email-row").classList.toggle("hidden", closed);
    $("participant-hint").classList.toggle("hidden", closed);
    showDetail();
    await Promise.all([loadThread(id), loadParticipants(id)]);
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

  // One file's download link + size (used inside a reply bubble or on its own).
  function attachLine(f) {
    const safeName = esc(f.filename).replace(/'/g, "");
    return `<div class="msg-attach">
      <a href="#" onclick="App.download(${f.id}, '${safeName}');return false;">📄 ${esc(f.filename)}</a>
      <span class="attach-size">${fileSize(f.size)}</span>
    </div>`;
  }

  async function loadThread(id) {
    const [comments, files] = await Promise.all([
      api(`/api/portal/tickets/${id}/comments`),
      api(`/api/portal/tickets/${id}/attachments`),
    ]);
    const thread = $("thread");
    // Files posted with a reply hang off that reply; files from the initial
    // submission (no comment) show as their own timestamped entry.
    const byComment = {}, orphans = [];
    for (const f of files) {
      if (f.comment_id) (byComment[f.comment_id] = byComment[f.comment_id] || []).push(f);
      else orphans.push(f);
    }
    const items = [];
    for (const c of comments) items.push({ t: c.created_at, kind: "note", data: c });
    for (const f of orphans) items.push({ t: f.created_at, kind: "file", data: f });
    if (!items.length) { thread.innerHTML = `<div class="thread-empty">No replies yet — our team will respond here.</div>`; return; }
    items.sort((a, b) => new Date(b.t) - new Date(a.t));   // newest first
    thread.innerHTML = items.map(it => {
      if (it.kind === "note") {
        const c = it.data;
        const mine = me && c.author_id === me.id;
        const who = mine ? "You" : "Axus Support";
        const atts = (byComment[c.id] || []).map(attachLine).join("");
        return `<div class="msg ${mine ? "me" : "them"}">
          <div class="msg-avatar">${mine ? initials(me.full_name) : "AX"}</div>
          <div class="msg-bubble">
            <div class="msg-meta">${who} · ${fmtDate(c.created_at)}</div>
            <div class="msg-body">${esc(c.body)}</div>
            ${atts}
          </div>
        </div>`;
      }
      const f = it.data;
      const mine = me && f.uploaded_by_id === me.id;
      const who = mine ? "You" : "Axus Support";
      return `<div class="msg ${mine ? "me" : "them"} msg-file">
        <div class="msg-avatar">📎</div>
        <div class="msg-bubble">
          <div class="msg-meta">${who} attached a file · ${fmtDate(f.created_at)}</div>
          ${attachLine(f)}
        </div>
      </div>`;
    }).join("");
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
  // Show the close-case attestation modal; resolves true (Confirm) / false (Cancel).
  function confirmClose() {
    return new Promise(resolve => {
      const modal = $("close-modal");
      modal.classList.remove("hidden");
      const finish = val => {
        modal.classList.add("hidden");
        $("close-confirm").onclick = $("close-cancel").onclick = $("close-x").onclick = null;
        resolve(val);
      };
      $("close-confirm").onclick = () => finish(true);
      $("close-cancel").onclick = () => finish(false);
      $("close-x").onclick = () => finish(false);
    });
  }
  async function reply(bodyText, files, close) {
    const res = await api(`/api/portal/tickets/${currentTicket}/comments`, { method: "POST", body: { body: bodyText || null, close: !!close } });
    const commentId = res && res.comment_id;   // tie the files to this reply
    for (const f of (files || [])) {
      const fd = new FormData(); fd.append("file", f);
      if (commentId) fd.append("comment_id", commentId);
      try { await api(`/api/portal/tickets/${currentTicket}/attachments`, { method: "POST", form: fd }); }
      catch (e) { toast(`Couldn't attach ${f.name}: ${e.message}`); }
    }
    if (close) { await openTicket(currentTicket); toast("Case closed"); }
    else { await loadThread(currentTicket); toast("Posted"); }
  }
  async function uploadFile(file) {
    const fd = new FormData(); fd.append("file", file);
    await api(`/api/portal/tickets/${currentTicket}/attachments`, { method: "POST", form: fd });
    await loadThread(currentTicket);
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

  // Append dropped/selected files onto an <input type=file> (preserving existing ones).
  function addFilesToInput(input, fileList) {
    const dt = new DataTransfer();
    for (const f of Array.from(input.files || [])) dt.items.add(f);
    for (const f of Array.from(fileList || [])) dt.items.add(f);
    input.files = dt.files;
  }
  // Turn any element into a drag-and-drop file target with visual feedback.
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

  function renderSelectedFiles() {
    const box = $("nt-file-list");
    const files = Array.from($("nt-files").files || []);
    if (!files.length) { box.innerHTML = ""; return; }
    box.innerHTML = files.map(f => {
      const ok = ALLOWED_EXTS.has(extOf(f.name));
      return `<div class="nt-file${ok ? "" : " nt-file-bad"}">${ok ? "📎" : "⛔"} ${esc(f.name)} <span class="attach-size">${fileSize(f.size)}</span>${ok ? "" : " — not an accepted format"}</div>`;
    }).join("");
  }

  // Staged files for the reply being written (with a remove ✕ on each).
  function renderReplyFiles() {
    const input = $("reply-files"), box = $("reply-file-list");
    const files = Array.from(input.files || []);
    if (!files.length) { box.innerHTML = ""; return; }
    box.innerHTML = files.map((f, i) => {
      const ok = ALLOWED_EXTS.has(extOf(f.name));
      return `<div class="nt-file${ok ? "" : " nt-file-bad"}">${ok ? "📎" : "⛔"} ${esc(f.name)} <span class="attach-size">${fileSize(f.size)}</span>${ok ? "" : " — not an accepted format"} <a href="#" class="reply-file-x" data-i="${i}" title="Remove">✕</a></div>`;
    }).join("");
    box.querySelectorAll(".reply-file-x").forEach(a => a.onclick = ev => {
      ev.preventDefault();
      const idx = parseInt(a.dataset.i, 10);
      const dt = new DataTransfer();
      files.forEach((f, j) => { if (j !== idx) dt.items.add(f); });
      input.files = dt.files; renderReplyFiles();
    });
  }

  /* ---------- Modal ---------- */
  function showNew() { $("new-modal").classList.remove("hidden"); $("nt-desc").style.height = ""; $("nt-title").focus(); }
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
      loginPanel("link");
      $("login-email").value = ""; $("login-email").focus();
    };

    // Toggle between magic-link and password sign-in.
    $("show-pw-login").onclick = e => {
      e.preventDefault();
      $("login-pw-email").value = $("login-email").value.trim();
      $("login-pw-error").textContent = "";
      loginPanel("pw");
      ($("login-pw-email").value ? $("login-pw-pass") : $("login-pw-email")).focus();
    };
    $("show-link-login").onclick = e => {
      e.preventDefault();
      $("login-email").value = $("login-pw-email").value.trim();
      $("login-error").textContent = "";
      loginPanel("link"); $("login-email").focus();
    };

    $("login-pw-form").onsubmit = async e => {
      e.preventDefault();
      $("login-pw-error").textContent = "";
      const email = $("login-pw-email").value.trim();
      const pass = $("login-pw-pass").value;
      if (!email || !pass) { $("login-pw-error").textContent = "Enter your email and password."; return; }
      $("login-pw-btn").disabled = true; $("login-pw-btn").textContent = "Signing in…";
      try {
        const r = await passwordLogin(email, pass);
        $("login-pw-pass").value = "";
        if (r.must_change_password) {
          showSetPassword({ forced: true });
        } else {
          await enterApp();
        }
      } catch (err) {
        $("login-pw-error").textContent = err.message;
      } finally {
        $("login-pw-btn").disabled = false; $("login-pw-btn").textContent = "Sign in";
      }
    };

    $("login-setpw-form").onsubmit = async e => {
      e.preventDefault();
      $("setpw-error").textContent = "";
      const forced = $("login-setpw-form").dataset.forced === "1";
      const cur = $("setpw-cur").value;
      const np = $("setpw-new").value;
      const cf = $("setpw-confirm").value;
      if (!forced && !cur) { $("setpw-error").textContent = "Enter your current password."; return; }
      if (np !== cf) { $("setpw-error").textContent = "The new passwords don't match."; return; }
      $("setpw-btn").disabled = true; $("setpw-btn").textContent = "Saving…";
      try {
        await setPassword(np, forced ? null : cur);
        toast("Password saved.");
        await enterApp();
      } catch (err) {
        $("setpw-error").textContent = err.message;
      } finally {
        $("setpw-btn").disabled = false; $("setpw-btn").textContent = "Save password & continue";
      }
    };
    $("logout-btn").onclick = logout;

    // Change password (voluntary, from inside the portal).
    const chpwClose = () => $("chpw-modal").classList.add("hidden");
    $("change-pw-btn").onclick = () => {
      $("chpw-cur").value = ""; $("chpw-new").value = ""; $("chpw-confirm").value = "";
      $("chpw-error").textContent = "";
      $("chpw-modal").classList.remove("hidden");
      $("chpw-cur").focus();
    };
    $("chpw-x").onclick = chpwClose;
    $("chpw-cancel").onclick = chpwClose;
    $("chpw-form").onsubmit = async e => {
      e.preventDefault();
      $("chpw-error").textContent = "";
      const cur = $("chpw-cur").value, np = $("chpw-new").value, cf = $("chpw-confirm").value;
      if (!cur) { $("chpw-error").textContent = "Enter your current password."; return; }
      if (np !== cf) { $("chpw-error").textContent = "The new passwords don't match."; return; }
      $("chpw-save").disabled = true; $("chpw-save").textContent = "Saving…";
      try {
        await setPassword(np, cur);
        chpwClose();
        toast("Password updated.");
      } catch (err) {
        $("chpw-error").textContent = err.message;
      } finally {
        $("chpw-save").disabled = false; $("chpw-save").textContent = "Update password";
      }
    };

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
      if (!await axusConfirm(`Raise this ticket's priority to ${prioLabel(p)}? Priority can be raised but not lowered from the portal.`)) return;
      try {
        await api(`/api/portal/tickets/${currentTicket}/priority`, { method: "PATCH", body: { priority: p } });
        await openTicket(currentTicket);
        toast(`Priority raised to ${prioLabel(p)}`);
      } catch (err) { toast(err.message); }
    };
    $("participant-add-btn").onclick = addParticipant;
    $("participant-email-btn").onclick = addParticipantEmail;
    $("participant-email").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addParticipantEmail(); } };

    $("reply-form").onsubmit = async e => {
      e.preventDefault();
      const body = $("reply-body").value.trim();
      const close = $("reply-close").checked;
      if (!body) { toast(close ? "Please add a note in the Conversation field before closing the case." : "Please enter your message before posting."); return; }
      const files = Array.from($("reply-files").files || []);
      const bad = files.filter(f => !ALLOWED_EXTS.has(extOf(f.name)));
      if (bad.length) { toast("These files aren't an accepted format: " + bad.map(f => f.name).join(", ")); return; }
      if (close && !(await confirmClose())) return;   // require attestation to close
      $("reply-body").value = ""; $("reply-body").style.height = "";   // reset if it was dragged larger
      $("reply-close").checked = false;
      $("reply-files").value = ""; renderReplyFiles();
      try { await reply(body, files, close); } catch (err) { toast(err.message); }
    };
    // Attach files to the reply being written (click the box or drag & drop onto it).
    $("reply-files").onchange = renderReplyFiles;
    wireDropzone($("reply-upload-box"), files => { addFilesToInput($("reply-files"), files); renderReplyFiles(); });

    $("nt-files").onchange = renderSelectedFiles;
    // Drag & drop: New Ticket collects files into the picker before submit.
    wireDropzone($("nt-upload-box"), files => { addFilesToInput($("nt-files"), files); renderSelectedFiles(); });
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
          contact_address: $("nt-address").value.trim() || null,
          contact_phone: $("nt-phone").value.trim() || null,
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
    // A forced password change (first login after a staff set/reset, or expiry)
    // must be completed before the portal is usable.
    if (me && me.must_change_password) {
      showSetPassword({ forced: true, title: "Set a new password",
        sub: "For your security, please choose a new password before continuing." });
      return;
    }
    showApp(); showList();
    await loadTickets();
    if (me && me.password_expiry_warning) toast(me.password_expiry_warning);
  }

  return { start, showNew, download };
})();

document.addEventListener("DOMContentLoaded", App.start);

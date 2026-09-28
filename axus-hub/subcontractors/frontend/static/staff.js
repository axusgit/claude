/* Axus Subcontractor Management — staff console (vanilla JS, no build step). */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  let ME = { permissions: [] };
  const can = (p) => ME.permissions.includes(p);

  const VENDOR_STATUSES = ["invited","onboarding","pending_review","approved",
    "missing_documents","expiring_soon","non_compliant","on_hold","inactive"];

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      headers: { "Content-Type": "application/json" }, ...opts,
    });
    if (!r.ok) {
      let detail = r.statusText;
      try { detail = (await r.json()).detail || detail; } catch (e) {}
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return r.status === 204 ? null : r.json();
  }

  // ---- status badges ----
  const B = {
    compliant: "b-ok", current: "b-ok", approved: "b-ok",
    expiring_soon: "b-warn", renewal_due: "b-warn", pending_review: "b-warn",
    pending: "b-warn", pending_signature: "b-warn", received: "b-warn",
    non_compliant: "b-bad", expired: "b-bad", rejected: "b-bad", missing: "b-muted",
    invited: "b-info", onboarding: "b-info", missing_documents: "b-warn",
    on_hold: "b-muted", inactive: "b-muted", unknown: "b-muted",
  };
  const badge = (s) => s ? `<span class="badge ${B[s] || "b-muted"}">${String(s).replace(/_/g," ")}</span>` : "—";

  // ---- views ----
  function showView(name, title) {
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === name));
    ["dashboard","directory","detail"].forEach(v => $("#view-"+v).classList.toggle("hidden", v !== name));
    $("#page-title").textContent = title || (name[0].toUpperCase()+name.slice(1));
  }

  async function loadDashboard() {
    showView("dashboard", "Dashboard");
    const s = await api("/api/subcontractors/stats");
    const tiles = [
      ["total_active","Active vendors",""],["approved","Approved",""],
      ["pending_onboarding","Pending onboarding",""],["pending_review","Pending review","warn"],
      ["missing_w9","Missing W-9","warn"],["coi_expiring_30","COIs expiring 30d","warn"],
      ["coi_expired","Expired COIs","bad"],["agreements_due_30","Agreements due 30d","warn"],
      ["agreements_overdue","Overdue agreements","bad"],["non_compliant","Non-compliant","bad"],
    ];
    $("#stats").innerHTML = tiles.map(([k,label,tone]) =>
      `<div class="stat-card ${s[k] ? tone : ""}" data-k="${k}">
         <div class="stat-num">${s[k] ?? 0}</div><div class="stat-label">${label}</div></div>`).join("");
    $$("#stats .stat-card").forEach(c => c.onclick = () => {
      const map = { pending_review:"pending_review", approved:"approved",
        non_compliant:"non_compliant" };
      $("#status-filter").value = map[c.dataset.k] || "";
      loadDirectory();
    });
  }

  async function loadDirectory() {
    showView("directory", "Directory");
    const q = $("#q").value.trim();
    const st = $("#status-filter").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (st) params.set("status", st);
    const list = await api("/api/subcontractors?" + params.toString());
    $("#rows").innerHTML = list.map(v => `
      <tr data-id="${v.id}">
        <td><strong>${esc(v.legal_name)}</strong><div class="cid">${v.public_id||""}</div></td>
        <td>${esc(v.primary_contact_name||"")}<div class="cid">${esc(v.phone||"")}</div></td>
        <td>${esc(v.email)}</td>
        <td>${esc([v.city,v.state].filter(Boolean).join(", "))}</td>
        <td>${badge(v.w9_status)}</td>
        <td>${badge(v.coi_status)}${v.coi_expiration_date?`<div class="cid">exp ${v.coi_expiration_date}</div>`:""}</td>
        <td>${badge(v.agreement_status)}</td>
        <td>${badge(v.compliance_status)}</td>
        <td>${badge(v.vendor_status)}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="muted" style="padding:24px">No subcontractors yet.</td></tr>`;
    $$("#rows tr[data-id]").forEach(tr => tr.onclick = () => openDetail(tr.dataset.id));
  }

  async function openDetail(id) {
    const [v, docs, notes] = await Promise.all([
      api("/api/subcontractors/"+id),
      api("/api/subcontractors/"+id+"/documents"),
      api("/api/subcontractors/"+id+"/notes"),
    ]);
    showView("detail", v.legal_name);
    const kv = (k,val) => `<div class="k">${k}</div><div>${esc(val||"—")}</div>`;
    const docRows = docs.map(d => `
      <li class="timeline-doc" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px dashed var(--border)">
        <span>${d.doc_type.toUpperCase()} v${d.version} ${badge(d.status)}
          ${d.expiration_date?`<span class="muted">· exp ${d.expiration_date}</span>`:""}
          <div class="cid">${esc(d.original_filename||"")} · ${d.uploaded_by||""}</div></span>
        <span class="actions">
          <a class="btn small" href="/api/subcontractors/${id}/documents/${d.id}/download">Download</a>
          ${can("review_compliance_documents") && d.status==="pending_review" ?
            `<button class="btn small primary" data-doc-approve="${d.id}" data-doc-type="${d.doc_type}">Approve</button>
             <button class="btn small danger" data-doc-reject="${d.id}">Reject</button>`:""}
        </span></li>`).join("") || `<li class="muted">No documents uploaded.</li>`;

    const acts = (v.recent_activity||[]).map(a =>
      `<li>${esc(a.detail||a.action)}<div class="t">${a.actor||"system"} · ${fmt(a.created_at)}</div></li>`).join("")
      || `<li class="muted">No activity.</li>`;
    const noteRows = notes.map(n =>
      `<li>${esc(n.body)}<div class="t">${n.author||""} · ${fmt(n.created_at)}</div></li>`).join("")
      || `<li class="muted">No notes.</li>`;

    $("#view-detail").innerHTML = `
      <div class="toolbar"><button class="btn" id="back">← Directory</button>
        <div style="flex:1"></div><div class="actions" id="vendor-actions"></div></div>
      <div class="detail-grid">
        <div>
          <div class="card"><h3>Overview</h3>
            <div class="kv">
              ${kv("ID", v.public_id)} ${kv("DBA", v.dba)}
              ${kv("Contact", v.primary_contact_name)} ${kv("Email", v.email)}
              ${kv("Phone", v.phone)} ${kv("Address", [v.address,v.city,v.state,v.zip].filter(Boolean).join(", "))}
              ${kv("Website", v.website)} ${kv("Services", v.services_provided)}
              ${kv("Coverage", v.geographic_coverage)}
            </div>
          </div>
          <div class="card"><h3>Compliance</h3>
            <div class="compliance-row">
              <div>W-9 ${badge(v.w9_status)}</div>
              <div>COI ${badge(v.coi_status)}${v.coi_expiration_date?` <span class="muted">exp ${v.coi_expiration_date}</span>`:""}</div>
              <div>Agreement ${badge(v.agreement_status)}</div>
              <div>Overall ${badge(v.compliance_status)}</div>
              <div>Status ${badge(v.vendor_status)}</div>
            </div>
          </div>
          <div class="card"><h3>Documents</h3><ul class="timeline">${docRows}</ul></div>
          <div class="card"><h3>Activity</h3><ul class="timeline">${acts}</ul></div>
        </div>
        <div>
          <div class="card"><h3>Notes (internal)</h3>
            <ul class="timeline" id="note-list">${noteRows}</ul>
            <textarea id="note-body" rows="2" style="width:100%;margin-top:8px" placeholder="Add an internal note…"></textarea>
            <button class="btn small" id="note-add" style="margin-top:6px">Add note</button>
          </div>
        </div>
      </div>`;
    $("#back").onclick = loadDirectory;

    // vendor-level action buttons (permission-gated)
    const A = [];
    if (can("invite_subcontractors")) A.push(`<button class="btn" data-act="invite">✉ Send / resend invite</button>`);
    if (can("approve_subcontractors")) A.push(`<button class="btn primary" data-review="approve">Approve</button>`);
    if (can("review_compliance_documents")) A.push(`<button class="btn" data-review="request_correction">Request correction</button>`);
    if (can("override_compliance_status")) A.push(`<button class="btn" data-review="hold">Hold</button>`);
    if (can("deactivate_subcontractors")) A.push(`<button class="btn danger" data-review="inactive">Mark inactive</button>`);
    $("#vendor-actions").innerHTML = A.join("");

    $$("#vendor-actions [data-review]").forEach(b => b.onclick = () => doReview(id, b.dataset.review));
    const inviteBtn = $("#vendor-actions [data-act=invite]");
    if (inviteBtn) inviteBtn.onclick = () => doInvite(id);
    $("#note-add").onclick = async () => {
      const body = $("#note-body").value.trim(); if (!body) return;
      await api(`/api/subcontractors/${id}/notes`, { method:"POST", body: JSON.stringify({ body }) });
      openDetail(id);
    };
    $$("[data-doc-approve]").forEach(b => b.onclick = () => reviewDoc(id, b.dataset.docApprove, "approve", b.dataset.docType));
    $$("[data-doc-reject]").forEach(b => b.onclick = () => reviewDoc(id, b.dataset.docReject, "reject"));
  }

  async function doInvite(id) {
    try {
      const r = await api(`/api/subcontractors/${id}/invite`, { method:"POST" });
      alert("Invitation " + (r.emailed ? "emailed." : "created (email disabled).") +
            "\n\nOnboarding link:\n" + r.link);
      openDetail(id);
    } catch (e) { alert("Error: " + e.message); }
  }

  async function doReview(id, action) {
    let reason = null;
    if (["request_correction","hold","reject"].includes(action))
      reason = prompt("Reason (optional):") || null;
    if (!confirm(`Confirm: ${action.replace(/_/g," ")}?`)) return;
    try {
      await api(`/api/subcontractors/${id}/review`, { method:"POST", body: JSON.stringify({ action, reason }) });
      openDetail(id);
    } catch (e) { alert("Error: " + e.message); }
  }

  async function reviewDoc(id, docId, action, docType) {
    const body = { action };
    if (action === "approve" && docType === "coi") {
      const exp = prompt("COI expiration date (YYYY-MM-DD):");
      if (!exp) return;
      body.expiration_date = exp;
    }
    if (action === "reject") body.reason = prompt("Rejection reason:") || null;
    try {
      await api(`/api/subcontractors/${id}/documents/${docId}/review`, { method:"POST", body: JSON.stringify(body) });
      openDetail(id);
    } catch (e) { alert("Error: " + e.message); }
  }

  // ---- add modal ----
  function openAdd() { $("#add-modal").classList.add("open"); }
  function closeAdd() { $("#add-modal").classList.remove("open"); }
  async function saveAdd() {
    const fields = ["legal_name","dba","primary_contact_name","email","phone","address",
      "city","state","zip","website","services_provided"];
    const body = {};
    fields.forEach(f => { const val = $("#f-"+f).value.trim(); if (val) body[f] = val; });
    if (!body.legal_name || !body.email) { alert("Company name and email are required."); return; }
    try {
      const v = await api("/api/subcontractors", { method:"POST", body: JSON.stringify(body) });
      closeAdd();
      fields.forEach(f => $("#f-"+f).value = "");
      openDetail(v.id);
    } catch (e) { alert("Error: " + e.message); }
  }

  // ---- helpers ----
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
  function fmt(t) { if (!t) return ""; const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString(); }

  // ---- init ----
  async function start() {
    try { ME = await api("/api/me"); } catch (e) { ME = { name:"?", role:"?", permissions:[] }; }
    $("#who-name").textContent = ME.name || "";
    $("#who-role").textContent = ME.role || "";
    $("#status-filter").insertAdjacentHTML("beforeend",
      VENDOR_STATUSES.map(s => `<option value="${s}">${s.replace(/_/g," ")}</option>`).join(""));
    $$(".nav-item").forEach(n => n.onclick = () => n.dataset.view === "dashboard" ? loadDashboard() : loadDirectory());
    $("#add-btn").onclick = openAdd;
    $("#add-cancel").onclick = closeAdd;
    $("#add-save").onclick = saveAdd;
    let t; $("#q").oninput = () => { clearTimeout(t); t = setTimeout(loadDirectory, 250); };
    $("#status-filter").onchange = loadDirectory;
    loadDashboard();
  }
  start();
})();

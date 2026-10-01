/* Axus Subcontractor onboarding portal (public, token-scoped). */
(function () {
  "use strict";
  const app = document.getElementById("app");
  // token is the last path segment of /onboarding/<token>
  const parts = location.pathname.split("/").filter(Boolean);
  const TOKEN = parts[parts.length - 1] && parts[parts.length - 1] !== "onboarding"
    ? parts[parts.length - 1] : "";

  const COMPANY_FIELDS = [
    ["legal_name","Legal company name",true],["dba","DBA",false],
    ["primary_contact_name","Primary contact",true],["email","Email",true],
    ["phone","Phone",true],["address","Business address",true],
    ["city","City",true],["state","State",true],["zip","ZIP",true],
    ["website","Website",false],["services_provided","Services provided",false],
    ["geographic_coverage","Geographic service area",false],
  ];

  async function api(path, opts = {}) {
    const r = await fetch(path, opts.body && !(opts.body instanceof FormData)
      ? { headers: { "Content-Type": "application/json" }, ...opts } : opts);
    if (!r.ok) {
      let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : (d.message || JSON.stringify(d)));
    }
    return r.json();
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const badgeClass = (s) => ({ current:"b-ok", approved:"b-ok", pending_review:"b-warn",
    received:"b-warn", expiring_soon:"b-warn", rejected:"b-bad", expired:"b-bad",
    missing:"b-muted", pending_signature:"b-warn" }[s] || "b-muted");
  const badge = (s) => `<span class="badge ${badgeClass(s)}">${String(s||"missing").replace(/_/g," ")}</span>`;

  async function load() {
    if (!TOKEN) return invalid();
    let st;
    try { st = await api("/api/onboarding/" + TOKEN); }
    catch (e) { return invalid(); }
    render(st);
  }

  function invalid() {
    app.innerHTML = `<div class="glass center">
      <h1>This link isn't valid</h1>
      <p class="sub">Your onboarding link may have expired. Please contact Axus Technologies for a new link.</p></div>`;
  }

  function render(st) {
    if (st.progress.submitted) return submitted(st);
    const p = st.progress;
    const signed = !!p.agreement_signed;         // subcontractor has signed → W-9/COI unlocked
    const done = (ok) => ok ? "done" : "todo";
    const w9ok = p.w9_status !== "missing" && p.w9_status !== "rejected";
    const coiok = ["current", "pending_review", "approved"].includes(p.coi_status);
    const steps = `
      <div class="steps">
        <div class="step ${done(p.company_complete)}"><span class="dot">${p.company_complete?"✓":"1"}</span>Company</div>
        <div class="step ${done(signed)}"><span class="dot">${signed?"✓":"2"}</span>Agreement</div>
        <div class="step ${done(signed && w9ok)}"><span class="dot">${signed&&w9ok?"✓":"3"}</span>W-9</div>
        <div class="step ${done(signed && coiok)}"><span class="dot">${signed&&coiok?"✓":"4"}</span>COI</div>
      </div>`;

    const c = st.company;
    const companyForm = COMPANY_FIELDS.map(([k,label,req]) =>
      `<div class="${['legal_name','address','services_provided','geographic_coverage'].includes(k)?'full':''}">
        <label>${label}${req?' <span class="req-tag">required</span>':''}</label>
        <input id="c-${k}" value="${esc(c[k]||"")}"${k==="email"?" readonly":""}></div>`).join("");

    const ai = st.coi_additional_insured || {};
    const lock = (msg) => `<div class="notice" style="background:rgba(107,114,128,.08)">🔒 ${msg}</div>`;

    // Agreement panel: before signing, direct them to the e-sign email; after, confirm done.
    const agreementPanel = signed
      ? `<div class="glass">
           <h2>2 · Subcontractor Agreement</h2>
           <div class="doc-row"><span>Agreement ${badge("approved")}</span></div>
           <p class="muted" style="font-size:13px">Thank you — your signature is recorded. Axus will counter-sign; you don't need to do anything further here for the agreement.</p>
         </div>`
      : `<div class="glass">
           <h2>2 · Subcontractor Agreement</h2>
           <div class="notice">We've emailed <strong>${esc(c.email||"you")}</strong> a secure link to review and electronically
             sign your <strong>Axus Subcontractor Agreement</strong>. Please sign it first — once you do, we'll ask for your
             W-9 and Certificate of Insurance below. (Check your spam folder if you don't see it; contact your Axus representative to resend.)</p>
           <div class="doc-row"><span>Agreement ${badge(p.agreement_status||"pending_signature")}</span></div>
         </div>`;

    // W-9 / COI: locked until the agreement is signed.
    const w9Panel = `<div class="glass">
        <h2>3 · W-9</h2>
        ${signed ? `<div class="doc-row"><span>Your completed IRS Form W-9 ${badge(p.w9_status)}</span></div>
          <label>Upload W-9</label>
          <input type="file" id="file-w9">
          <div style="margin-top:10px"><button class="btn ghost" id="up-w9">Upload W-9</button></div>`
          : lock("Available after you sign the Subcontractor Agreement.")}
      </div>`;
    const coiPanel = `<div class="glass">
        <h2>4 · Certificate of Insurance</h2>
        ${signed ? `<div class="notice">Please make sure your COI names <strong>${esc(ai.name||"Axus Technologies")}</strong>
            as an <strong>additional insured</strong>:<br>${esc(ai.address||"")}</div>
          <div class="doc-row"><span>Current COI ${badge(p.coi_status)}</span></div>
          <label>Upload COI</label>
          <input type="file" id="file-coi">
          <div style="margin-top:10px"><button class="btn ghost" id="up-coi">Upload COI</button></div>`
          : lock("Available after you sign the Subcontractor Agreement.")}
      </div>`;

    const canSubmit = signed && st.outstanding.length === 0;
    app.innerHTML = `
      <div class="glass">
        <h1>Welcome${c.primary_contact_name?`, ${esc(c.primary_contact_name)}`:""}</h1>
        <p class="sub">Complete the steps below to onboard as an Axus Technologies subcontractor.
          Your progress is saved as you go — ID <strong>${st.public_id||""}</strong>.</p>
        ${steps}
        ${!signed
          ? `<div class="notice">Next step: sign your Subcontractor Agreement using the link we emailed you.</div>`
          : (st.outstanding.length ? `<div class="notice">Outstanding: ${st.outstanding.map(esc).join(", ")}</div>`
            : `<div class="notice" style="background:rgba(22,163,74,.08);border-color:rgba(22,163,74,.3)">All items complete — you can submit for review.</div>`)}
      </div>

      <div class="glass">
        <h2>1 · Company information</h2>
        <div class="form-grid">${companyForm}</div>
        <div style="margin-top:14px"><button class="btn" id="save-company">Save company info</button></div>
      </div>

      ${agreementPanel}
      ${w9Panel}
      ${coiPanel}

      <div class="glass">
        <h2>Submit for review</h2>
        <p class="muted" style="font-size:13px">${signed
          ? "When your W-9 and COI are uploaded, submit for Axus review. Axus will then approve your documents and counter-sign the agreement."
          : "Sign your Subcontractor Agreement first; the W-9 and COI steps unlock once you've signed."}</p>
        <button class="btn" id="submit" ${canSubmit ? "" : "disabled"}>Submit for review</button>
      </div>`;

    document.getElementById("save-company").onclick = saveCompany;
    if (signed) {
      document.getElementById("up-w9").onclick = () => upload("w9", "file-w9");
      document.getElementById("up-coi").onclick = () => upload("coi", "file-coi");
    }
    document.getElementById("submit").onclick = submit;
  }

  function submitted(st) {
    app.innerHTML = `<div class="glass center">
      <h1>Submitted for review ✓</h1>
      <p class="sub">Thanks! Your onboarding for <strong>${esc(st.company.legal_name||"")}</strong>
        (${st.public_id||""}) is complete and with the Axus team for review.
        We'll be in touch, and you can revisit this link anytime to check your status.</p>
      <div class="steps" style="justify-content:center;margin-top:10px">
        <div class="step done"><span class="dot">✓</span>Company</div>
        <div class="step done"><span class="dot">✓</span>Agreement</div>
        <div class="step done"><span class="dot">✓</span>W-9</div>
        <div class="step done"><span class="dot">✓</span>COI</div>
        <div class="step done"><span class="dot">✓</span>Submitted</div>
      </div></div>`;
  }

  async function saveCompany() {
    const body = {};
    COMPANY_FIELDS.forEach(([k]) => { const v = document.getElementById("c-"+k).value.trim(); if (v !== "") body[k] = v; });
    try { const st = await api("/api/onboarding/" + TOKEN + "/company", { method:"PATCH", body: JSON.stringify(body) }); render(st); }
    catch (e) { axusAlert("Error: " + e.message); }
  }

  async function upload(docType, inputId) {
    const f = document.getElementById(inputId).files[0];
    if (!f) { axusAlert("Please choose a file first."); return; }
    const fd = new FormData(); fd.append("doc_type", docType); fd.append("file", f);
    try { const st = await api("/api/onboarding/" + TOKEN + "/documents", { method:"POST", body: fd }); render(st); }
    catch (e) { axusAlert("Upload failed: " + e.message); }
  }

  async function submit() {
    try { const st = await api("/api/onboarding/" + TOKEN + "/submit", { method:"POST" }); render(st); }
    catch (e) { axusAlert("Cannot submit yet: " + e.message); }
  }

  load();
})();

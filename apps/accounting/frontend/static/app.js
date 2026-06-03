/* ===================== Axus Accounting ===================== */
(() => {
  const THEME_KEY = "axus-theme";
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = v => "$" + (Math.round((v || 0) * 100) / 100).toLocaleString();
  const today = () => new Date().toISOString().slice(0, 10);
  let invoices = [], customers = [], customerMap = {};

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    document.querySelectorAll(".theme-icon").forEach(el => el.textContent = t === "dark" ? "☀️" : "🌙");
  }
  const toggleTheme = () => applyTheme((document.documentElement.getAttribute("data-theme") || "light") === "dark" ? "light" : "dark");

  async function api(path, opts = {}) {
    const init = { credentials: "include", headers: {} };
    if (opts.method) init.method = opts.method;
    if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    const r = await fetch(path, init);
    if (!r.ok) { let d = "HTTP " + r.status; try { const j = await r.json(); if (typeof j.detail === "string") d = j.detail; } catch (e) {} throw new Error(d); }
    return r.json();
  }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 2400); }

  async function loadAll() {
    const [summary, inv, cust] = await Promise.all([api("/api/summary"), api("/api/invoices"), api("/api/customers")]);
    invoices = inv; customers = cust; customerMap = {}; cust.forEach(c => customerMap[c.id] = c.name);
    renderStats(summary); renderInvoices();
  }
  function renderStats(s) {
    $("stats-row").innerHTML = s.kpis.map(k =>
      `<div class="stat-card"><div class="stat-num ${k.tone || ""}">${k.value}</div><div class="stat-label">${esc(k.label)}</div></div>`).join("");
  }
  function statusBadge(inv) {
    if (inv.status === "sent" && inv.due_date && inv.due_date < today()) return `<span class="badge overdue">Overdue</span>`;
    return `<span class="badge ${inv.status}">${inv.status}</span>`;
  }
  function renderInvoices() {
    const tb = $("rows"); tb.innerHTML = "";
    $("empty").classList.toggle("hidden", invoices.length > 0);
    invoices.forEach(inv => {
      const tr = document.createElement("tr");
      tr.onclick = () => openInvoice(inv.id);
      tr.innerHTML = `<td class="cell-num">${esc(inv.number || "—")}</td>
        <td>${esc(customerMap[inv.customer_id] || "—")}</td>
        <td>${statusBadge(inv)}</td>
        <td class="muted">${inv.issue_date || "—"}</td>
        <td class="muted">${inv.due_date || "—"}</td>
        <td class="right">${money(inv.total)}</td>`;
      tb.appendChild(tr);
    });
  }

  /* ---------- New invoice ---------- */
  function lineRow() {
    const row = document.createElement("div");
    row.className = "line-row";
    row.innerHTML = `<input class="li-desc" placeholder="Description" />
      <input class="li-qty" type="number" step="0.5" value="1" />
      <input class="li-price" type="number" step="0.01" value="0" />
      <span class="line-amt">$0</span><span class="line-rm">×</span>`;
    const recalc = () => { row.querySelector(".line-amt").textContent = money((+row.querySelector(".li-qty").value || 0) * (+row.querySelector(".li-price").value || 0)); newTotal(); };
    row.querySelectorAll("input").forEach(i => i.oninput = recalc);
    row.querySelector(".line-rm").onclick = () => { row.remove(); newTotal(); };
    return row;
  }
  function newTotal() {
    let t = 0;
    $("line-items").querySelectorAll(".line-row").forEach(r => t += (+r.querySelector(".li-qty").value || 0) * (+r.querySelector(".li-price").value || 0));
    $("iv-total").textContent = money(t);
  }
  function openNew() {
    $("nm-error").textContent = ""; $("new-form").reset();
    $("iv-customer").innerHTML = customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    $("line-items").innerHTML = ""; $("line-items").appendChild(lineRow()); newTotal();
    $("new-modal").classList.remove("hidden");
  }
  async function submitNew(e) {
    e.preventDefault(); $("nm-error").textContent = "";
    const items = [...$("line-items").querySelectorAll(".line-row")].map(r => ({
      description: r.querySelector(".li-desc").value.trim(),
      quantity: +r.querySelector(".li-qty").value || 0,
      unit_price: +r.querySelector(".li-price").value || 0,
    })).filter(li => li.description);
    if (!items.length) { $("nm-error").textContent = "Add at least one line item"; return; }
    try {
      await api("/api/invoices", { method: "POST", body: {
        customer_id: +$("iv-customer").value, due_date: $("iv-due").value || null,
        notes: $("iv-notes").value.trim() || null, line_items: items } });
      $("new-modal").classList.add("hidden"); await loadAll(); toast("Invoice created");
    } catch (err) { $("nm-error").textContent = err.message; }
  }

  /* ---------- Invoice detail ---------- */
  let currentId = null;
  async function openInvoice(id) {
    currentId = id;
    const inv = await api(`/api/invoices/${id}`);
    $("d-number").textContent = inv.number || "Invoice";
    $("d-customer").textContent = inv.customer_name || "—";
    $("d-status").className = "badge " + inv.status; $("d-status").textContent = inv.status;
    $("d-issued").textContent = inv.issue_date || "—";
    $("d-due").textContent = inv.due_date || "—";
    $("d-lines").innerHTML = (inv.line_items || []).map(li =>
      `<tr><td>${esc(li.description)}</td><td class="right">${li.quantity}</td><td class="right">${money(li.unit_price)}</td><td class="right">${money(li.amount)}</td></tr>`).join("");
    $("d-total").textContent = money(inv.total);
    const acts = [];
    if (inv.status === "draft") acts.push(["Mark Sent", "sent", "btn-primary"]);
    if (inv.status === "sent") acts.push(["Mark Paid", "paid", "btn-primary"]);
    if (inv.status !== "paid" && inv.status !== "void") acts.push(["Void", "void", "btn-ghost"]);
    $("d-actions").innerHTML = acts.map(([label, st, cls]) => `<button class="btn ${cls}" data-st="${st}">${label}</button>`).join("");
    $("d-actions").querySelectorAll("button").forEach(b => b.onclick = () => setStatus(b.dataset.st));
    $("detail-modal").classList.remove("hidden");
  }
  async function setStatus(st) {
    try { await api(`/api/invoices/${currentId}/status`, { method: "PUT", body: { status: st } });
      $("detail-modal").classList.add("hidden"); await loadAll(); toast("Invoice " + st); }
    catch (err) { toast(err.message); }
  }

  async function start() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    $("new-btn").onclick = openNew;
    $("add-line").onclick = () => $("line-items").appendChild(lineRow());
    $("new-form").onsubmit = submitNew;
    $("nm-close").onclick = $("nm-cancel").onclick = () => $("new-modal").classList.add("hidden");
    $("dm-close").onclick = () => $("detail-modal").classList.add("hidden");
    try { await loadAll(); } catch (e) { toast("Failed to load: " + e.message); }
    $("loading").classList.add("hidden"); $("app").classList.remove("hidden");
  }
  document.addEventListener("DOMContentLoaded", start);
})();

/* ===================== Axus Hub — application frame ===================== */
(() => {
  const THEME_KEY = "axus-theme";
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = n => (n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  const TITLES = { dashboard: "Dashboard", apps: "Products", monitoring: "Monitoring", reports: "Reports", admin: "Administration" };
  let me = null, health = {};

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
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  /* ---------- navigation ---------- */
  function showView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    $("view-" + name).classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === name));
    $("page-title").textContent = TITLES[name] || "Hub";
    if (name === "monitoring") loadHealth();
  }

  /* ---------- shared render helpers ---------- */
  function appTile(a, compact) {
    const t = document.createElement(a.coming_soon ? "div" : "a");
    t.className = a.coming_soon ? "app-tile coming-soon" : "app-tile";
    t.href = a.url;
    t.target = "_blank";           // launch each app in its own tab
    t.rel = "noopener";
    t.innerHTML = `
      <span class="app-status ${health[a.key] || ""}" data-app="${a.key}"></span>
      <div class="app-icon">${a.icon}</div>
      <div class="app-name">${esc(a.name)}</div>
      <div class="app-desc">${esc(a.desc)}</div>
      <div class="app-launch">${a.coming_soon ? "Coming soon" : "Launch →"}</div>`;
    return t;
  }

  function renderProfile() {
    $("side-name").textContent = me.name;
    $("side-role").textContent = cap(me.role);
    $("avatar").textContent = initials(me.name);
    $("account-link").href = me.account_url || "#";
    $("hero-title").textContent = `Welcome back, ${me.name.split(" ")[0]}`;
    $("hero-sub").textContent = `You have access to ${me.apps.length} product${me.apps.length === 1 ? "" : "s"}.`;
    document.querySelectorAll(".admin-only").forEach(el => { el.style.display = me.is_admin ? "" : "none"; });
  }

  async function renderDashboard() {
    renderStats();
    renderStatusList();
    renderActions();
    try {
      const d = await api("/api/dashboard");
      renderCommandCenter(d.systems);
    } catch (e) {
      renderCommandCenter([]);
    }
  }

  // Aggregate platform counts derived from the app catalog + live health.
  function dashCounts() {
    const live = me.apps.filter(a => !a.coming_soon);
    return {
      total: live.length,
      soon: me.apps.filter(a => a.coming_soon).length,
      up: live.filter(a => health[a.key] === "up").length,
      issues: live.filter(a => health[a.key] === "down" || health[a.key] === "degraded").length,
    };
  }

  function renderStats() {
    const c = dashCounts();
    $("dash-stats").innerHTML =
      stat(c.total, "Products", "accent") +
      stat(c.up, "Online now", "good") +
      stat(c.issues, "Needs attention", c.issues ? "bad" : "") +
      stat(c.soon, "In development", "");
    const parts = [`${c.total} product${c.total === 1 ? "" : "s"}`];
    if (c.up) parts.push(`${c.up} online`);
    if (c.issues) parts.push(`${c.issues} need${c.issues === 1 ? "s" : ""} attention`);
    parts.push(`you're ${me.is_admin ? "an administrator" : "a " + me.role}`);
    $("hero-sub").textContent = parts.join(" · ");
    const ss = $("status-summary"); if (ss) ss.textContent = `${c.up}/${c.total} online`;
  }

  // Compact live-status list of every product (distinct from the launcher tiles).
  function renderStatusList() {
    $("dash-health").innerHTML = me.apps.map(a => {
      if (a.coming_soon) {
        return `<div class="status-row">
          <span class="status-ic">${a.icon}</span>
          <span class="status-name">${esc(a.name)}</span>
          <span class="status-tag">Planned</span></div>`;
      }
      return `<div class="status-row">
        <span class="status-ic">${a.icon}</span>
        <span class="status-name">${esc(a.name)}</span>
        <span class="pill ${health[a.key] || ""}" data-mon="${a.key}">${health[a.key] || "checking…"}</span>
        <a class="status-open" href="${a.url}" target="_blank" rel="noopener">Open →</a></div>`;
    }).join("") || `<div class="muted">No products.</div>`;
  }

  // Role-aware shortcuts — useful things to DO, not a second launcher grid.
  function renderActions() {
    const base = me.authentik_url;
    const acts = [
      { icon: "🧩", label: "Browse all products", sub: "Open the product launcher", goto: "apps" },
      { icon: "👤", label: "Account settings", sub: "Profile, password & MFA", href: me.account_url || "#" },
    ];
    if (me.is_admin) {
      acts.push({ icon: "👥", label: "Manage users", sub: "Add or edit platform accounts", href: `${base}/if/admin/#/identity/users` });
      acts.push({ icon: "📡", label: "Platform monitoring", sub: "Live status of every service", goto: "monitoring" });
    }
    $("dash-actions").innerHTML = acts.map(a => {
      const attrs = a.goto ? `data-goto="${a.goto}" href="#"` : `href="${a.href}" target="_blank" rel="noopener"`;
      return `<a class="action-row" ${attrs}>
        <span class="action-ic">${a.icon}</span>
        <span class="action-meta"><span class="action-label">${esc(a.label)}</span><span class="action-sub">${esc(a.sub)}</span></span>
        <span class="action-arrow">→</span></a>`;
    }).join("");
  }

  // Live metrics: ONLY systems actually reporting data — no empty "not connected" cards.
  function renderCommandCenter(systems) {
    const live = (systems || []).filter(s => s.available);
    const cc = $("command-center");
    if (!live.length) {
      cc.className = "metrics-wrap";
      cc.innerHTML = `<div class="metrics-empty muted">Live product metrics appear here as each product connects its data. Until then, the status panel below shows what's online.</div>`;
      return;
    }
    cc.className = "command-center";
    cc.innerHTML = live.map(s => {
      const kpis = s.kpis.map(k =>
        `<div class="kpi"><div class="kpi-val ${k.tone || ""}">${k.value}</div><div class="kpi-label">${esc(k.label)}</div></div>`).join("");
      return `<div class="sys-panel">
        <div class="sys-head"><div class="sys-title"><span class="sys-icon">${s.icon}</span>${esc(s.name)}</div>
          <a class="link" href="${s.url}" target="_blank" rel="noopener">Open →</a></div>
        <div class="kpi-row">${kpis}</div>
        ${s.footnote ? `<div class="sys-foot muted">${esc(s.footnote)}</div>` : ""}</div>`;
    }).join("");
  }

  const stat = (n, label, cls) => `<div class="stat-card"><div class="stat-num ${cls}">${n}</div><div class="stat-label">${label}</div></div>`;

  function renderApps() {
    const wrap = $("launcher"); wrap.innerHTML = "";
    $("apps-count").textContent = me.apps.length ? `${me.apps.length} available` : "";
    $("no-apps").classList.toggle("hidden", me.apps.length > 0);
    // Group tiles by category. Uncategorized apps render first (no header);
    // categorized ones (e.g. "Axus Tools") get a full-width section heading.
    const cats = {}, order = [];
    me.apps.forEach(a => {
      const c = a.category || "";
      if (!(c in cats)) { cats[c] = []; order.push(c); }
      cats[c].push(a);
    });
    order.forEach(c => {
      if (c) {
        const h = document.createElement("h3");
        h.className = "launcher-section";
        h.textContent = c;
        wrap.appendChild(h);
      }
      cats[c].forEach(a => wrap.appendChild(appTile(a, false)));
    });
  }

  function renderMonitoring() {
    $("mon-rows").innerHTML = me.apps.filter(a => !a.coming_soon).map(a => {
      const s = health[a.key] || "";
      return `<tr><td>${esc(a.name)}</td>
        <td><span class="pill ${s}" data-mon="${a.key}">${s || "checking…"}</span></td>
        <td class="muted">${esc(a.url)}</td></tr>`;
    }).join("") || `<tr><td colspan="3" class="muted">No products.</td></tr>`;
  }

  function renderReports() {
    $("report-stats").innerHTML = `
      ${stat(me.apps.filter(a => !a.coming_soon).length, "Connected apps", "accent")}
      ${stat(Object.values(health).filter(s => s === "up").length, "Online now", "good")}
      ${stat("—", "Open tickets", "")}
      ${stat("—", "Revenue (MTD)", "")}`;
  }

  function renderAdmin() {
    if (!me.is_admin) { $("admin-grid").innerHTML = `<div class="muted">Administrator access required.</div>`; return; }
    const base = me.authentik_url;
    const cards = [
      { icon: "👥", title: "Users", desc: "Create and manage platform user accounts.", href: `${base}/if/admin/#/identity/users` },
      { icon: "🔑", title: "Roles & Groups", desc: "Manage role-* and app-* groups that grant access.", href: `${base}/if/admin/#/identity/groups` },
      { icon: "🧩", title: "Applications", desc: "Configure connected apps, providers and outposts.", href: `${base}/if/admin/#/core/applications` },
      { icon: "🛡️", title: "Identity Console", desc: "Full Authentik admin: flows, policies, MFA, events.", href: `${base}/if/admin/` },
    ];
    $("admin-grid").innerHTML = cards.map(c => `
      <a class="admin-card" href="${c.href}" target="_blank" rel="noopener">
        <span class="ac-icon">${c.icon}</span><h4>${c.title}</h4><p>${c.desc}</p>
        <span class="link">Open →</span></a>`).join("");
    if (me.is_admin) initGeo();
  }

  /* ---------- Country access control ---------- */
  const COUNTRIES = [["US","United States"],["CA","Canada"],["MX","Mexico"],["GB","United Kingdom"],["IE","Ireland"],["FR","France"],["DE","Germany"],["ES","Spain"],["PT","Portugal"],["IT","Italy"],["NL","Netherlands"],["BE","Belgium"],["CH","Switzerland"],["AT","Austria"],["SE","Sweden"],["NO","Norway"],["DK","Denmark"],["FI","Finland"],["PL","Poland"],["CZ","Czechia"],["RO","Romania"],["GR","Greece"],["UA","Ukraine"],["RU","Russia"],["BY","Belarus"],["TR","Turkey"],["IL","Israel"],["SA","Saudi Arabia"],["AE","United Arab Emirates"],["IN","India"],["PK","Pakistan"],["BD","Bangladesh"],["CN","China"],["HK","Hong Kong"],["TW","Taiwan"],["JP","Japan"],["KR","South Korea"],["KP","North Korea"],["VN","Vietnam"],["TH","Thailand"],["PH","Philippines"],["ID","Indonesia"],["MY","Malaysia"],["SG","Singapore"],["AU","Australia"],["NZ","New Zealand"],["BR","Brazil"],["AR","Argentina"],["CL","Chile"],["CO","Colombia"],["PE","Peru"],["ZA","South Africa"],["NG","Nigeria"],["EG","Egypt"],["KE","Kenya"],["IR","Iran"],["IQ","Iraq"],["SY","Syria"],["AF","Afghanistan"],["NP","Nepal"]];
  const COUNTRY_NAME = Object.fromEntries(COUNTRIES);
  let geoPolicy = { mode: "off", countries: [] };

  async function initGeo() {
    try { geoPolicy = await api("/api/geo/policy"); } catch (e) { return; }
    $("geo-card").style.display = "";
    $("geo-country-pick").innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${esc(n)} (${c})</option>`).join("");
    $("geo-mode").value = geoPolicy.mode || "off";
    renderGeo();
    $("geo-mode").onchange = () => { geoPolicy.mode = $("geo-mode").value; renderGeo(); };
    $("geo-add-btn").onclick = () => {
      const c = $("geo-country-pick").value;
      if (c && !geoPolicy.countries.includes(c)) { geoPolicy.countries.push(c); renderGeo(); }
    };
    $("geo-save").onclick = saveGeo;
  }
  function renderGeo() {
    const showList = geoPolicy.mode !== "off";
    $("geo-countries-wrap").style.display = showList ? "" : "none";
    $("geo-chips").innerHTML = (geoPolicy.countries || []).map(c =>
      `<span class="geo-chip">${esc(COUNTRY_NAME[c] || c)} (${c}) <b data-rm="${c}">×</b></span>`).join("")
      || `<span class="muted">No countries selected.</span>`;
    $("geo-chips").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
      geoPolicy.countries = geoPolicy.countries.filter(x => x !== b.dataset.rm); renderGeo();
    });
  }
  async function saveGeo() {
    $("geo-status").textContent = "Saving…";
    try {
      geoPolicy = await api("/api/geo/policy", { method: "PUT", body: { mode: geoPolicy.mode, countries: geoPolicy.countries } });
      $("geo-status").textContent = "Saved ✓"; setTimeout(() => $("geo-status").textContent = "", 2500);
    } catch (e) { $("geo-status").textContent = "Save failed"; }
  }

  async function loadHealth() {
    try { health = await api("/api/apps/health"); } catch (e) { return; }
    for (const [key, state] of Object.entries(health)) {
      document.querySelectorAll(`[data-app="${key}"]`).forEach(el => { el.className = "app-status " + state; });
      document.querySelectorAll(`[data-mon="${key}"]`).forEach(el => { el.className = "pill " + state; el.textContent = state; });
    }
    if (me) renderStats();  // refresh Online / Needs-attention counts + hero summary
  }

  function wireSearch() {
    $("search").oninput = e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".app-tile").forEach(t => { t.style.display = t.textContent.toLowerCase().includes(q) ? "" : "none"; });
      if (q) showView("apps");
    };
  }

  async function start() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    try { me = await api("/api/me"); }
    catch (e) { window.location.href = "/outpost.goauthentik.io/start?rd=" + encodeURIComponent(location.href); return; }

    renderProfile();
    renderDashboard(); renderApps(); renderMonitoring(); renderReports(); renderAdmin();
    wireSearch();

    document.querySelectorAll(".nav-item").forEach(n => n.onclick = () => showView(n.dataset.view));
    document.querySelectorAll("[data-goto]").forEach(el => el.onclick = e => { e.preventDefault(); showView(el.dataset.goto); });

    $("refresh-health").onclick = loadHealth;
    $("loading").classList.add("hidden");
    $("app").classList.remove("hidden");
    loadHealth();
    // Auto-refresh product health every 60s (skip while the tab is hidden).
    setInterval(() => { if (!document.hidden) loadHealth(); }, 60000);
  }

  document.addEventListener("DOMContentLoaded", start);
})();

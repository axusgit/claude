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
    $("dash-health").innerHTML = me.apps.filter(a => !a.coming_soon).map(a => `
      <div class="health-row"><span class="health-dot ${health[a.key] || ""}" data-health="${a.key}"></span>
        <span>${esc(a.name)}</span><span class="health-state" data-state="${a.key}">${health[a.key] || "checking…"}</span></div>`).join("")
      || `<div class="muted">No products.</div>`;
    try {
      const d = await api("/api/dashboard");
      renderCommandCenter(d.systems);
    } catch (e) {
      $("command-center").innerHTML = `<div class="muted">Unable to load metrics.</div>`;
    }
  }

  function renderCommandCenter(systems) {
    $("command-center").innerHTML = systems.map(s => {
      if (!s.available) {
        return `<div class="sys-panel unavailable">
          <div class="sys-head"><div class="sys-title"><span class="sys-icon">${s.icon}</span>${esc(s.name)}</div></div>
          <div class="sys-empty muted">Not yet connected</div></div>`;
      }
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
    me.apps.forEach(a => wrap.appendChild(appTile(a, false)));
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
      const dot = document.querySelector(`[data-health="${key}"]`); if (dot) dot.className = "health-dot " + state;
      const st = document.querySelector(`[data-state="${key}"]`); if (st) st.textContent = state;
      const mon = document.querySelector(`[data-mon="${key}"]`); if (mon) { mon.className = "pill " + state; mon.textContent = state; }
    }
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

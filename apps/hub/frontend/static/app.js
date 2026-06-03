/* ===================== Axus Hub — dashboard ===================== */
(() => {
  const THEME_KEY = "axus-theme";
  const $ = id => document.getElementById(id);
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = n => (n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  let me = null;

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    document.querySelectorAll(".theme-icon").forEach(el => el.textContent = t === "dark" ? "☀️" : "🌙");
  }
  const toggleTheme = () => applyTheme((document.documentElement.getAttribute("data-theme") || "light") === "dark" ? "light" : "dark");

  async function api(path) {
    const r = await fetch(path, { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function renderProfile() {
    $("who-name").textContent = me.name;
    $("who-role").textContent = me.role.charAt(0).toUpperCase() + me.role.slice(1);
    $("avatar").textContent = initials(me.name);
    $("hero-title").textContent = `Welcome back, ${me.name.split(" ")[0]}`;
    const n = me.apps.length;
    $("hero-sub").textContent = `You have access to ${n} application${n === 1 ? "" : "s"}.`;
    $("account-link").href = me.account_url || "#";
    if (me.is_admin && me.admin_url) {
      $("admin-card").style.display = "";
      $("admin-link").href = me.admin_url;
    }
  }

  function renderLauncher() {
    const wrap = $("launcher");
    $("apps-count").textContent = me.apps.length ? `${me.apps.length} available` : "";
    $("no-apps").classList.toggle("hidden", me.apps.length > 0);
    wrap.innerHTML = "";
    me.apps.forEach(a => {
      const tile = document.createElement("a");
      tile.className = "app-tile";
      tile.href = a.url;
      tile.innerHTML = `
        <span class="app-status" data-app="${a.key}"></span>
        <div class="app-icon">${a.icon}</div>
        <div class="app-name">${esc(a.name)}</div>
        <div class="app-desc">${esc(a.desc)}</div>
        <div class="app-launch">Launch →</div>`;
      wrap.appendChild(tile);
    });
    // health list mirrors the launcher
    $("health-list").innerHTML = me.apps.map(a => `
      <div class="health-row">
        <span class="health-dot" data-health="${a.key}"></span>
        <span>${esc(a.name)}</span>
        <span class="health-state" data-state="${a.key}">checking…</span>
      </div>`).join("") || `<div class="muted">No applications.</div>`;
  }

  async function loadHealth() {
    let health = {};
    try { health = await api("/api/apps/health"); } catch (e) { return; }
    for (const [key, state] of Object.entries(health)) {
      document.querySelectorAll(`.app-status[data-app="${key}"]`).forEach(el => el.classList.add(state));
      const dot = document.querySelector(`.health-dot[data-health="${key}"]`);
      if (dot) dot.classList.add(state);
      const lbl = document.querySelector(`.health-state[data-state="${key}"]`);
      if (lbl) lbl.textContent = state;
    }
  }

  function wireSearch() {
    $("search").oninput = e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".app-tile").forEach(t => {
        const txt = t.textContent.toLowerCase();
        t.style.display = txt.includes(q) ? "" : "none";
      });
    };
  }

  async function start() {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    $("theme-toggle").onclick = toggleTheme;
    try {
      me = await api("/api/me");
    } catch (e) {
      // In production the gateway authenticates before we get here; a 401 means
      // the session expired — bounce to re-auth.
      window.location.href = "/outpost.goauthentik.io/start?rd=" + encodeURIComponent(location.href);
      return;
    }
    renderProfile();
    renderLauncher();
    wireSearch();
    $("loading").classList.add("hidden");
    $("app").classList.remove("hidden");
    loadHealth();
  }

  document.addEventListener("DOMContentLoaded", start);
})();

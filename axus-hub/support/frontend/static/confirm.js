/* Axus centered confirm/alert modal — a Promise-based, screen-centered
 * replacement for the native window.confirm()/alert(), which browsers pin to the
 * TOP of the window. Shared verbatim across Axus apps (support, hub,
 * subcontractors, accounting). Exposes window.axusConfirm() / window.axusAlert().
 *
 *   if (!(await axusConfirm("Delete this?", { danger: true }))) return;
 *   await axusAlert("Saved.");
 *
 * Self-contained: injects its own scoped styles and adapts to light/dark
 * (honours <html data-theme="dark"> and prefers-color-scheme). */
(function () {
  if (window.axusConfirm) return; // idempotent

  var STYLE_ID = "axus-modal-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = `
    .axm-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
      justify-content:center;padding:16px;background:rgba(15,23,42,.45);
      -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
      animation:axm-fade .12s ease-out;}
    .axm-card{width:100%;max-width:420px;background:#fff;color:#0f172a;
      border:1px solid rgba(0,0,0,.08);border-radius:14px;
      box-shadow:0 20px 60px rgba(2,6,23,.35);padding:22px 22px 18px;
      font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;
      animation:axm-pop .14s cubic-bezier(.2,.9,.3,1.2);}
    .axm-title{font-family:Poppins,Inter,sans-serif;font-weight:700;font-size:16px;margin:0 0 8px;}
    .axm-msg{font-size:14px;line-height:1.55;white-space:pre-line;margin:0;color:#334155;}
    .axm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px;}
    .axm-btn{font:600 14px/1 Inter,sans-serif;padding:10px 18px;border-radius:9px;
      cursor:pointer;border:1px solid transparent;transition:filter .12s,background .12s;}
    .axm-cancel{background:transparent;border-color:rgba(0,0,0,.16);color:#475569;}
    .axm-cancel:hover{background:rgba(0,0,0,.04);}
    .axm-ok{background:linear-gradient(135deg,#f26522,#f7941d);color:#fff;box-shadow:0 4px 12px rgba(242,101,34,.35);}
    .axm-ok:hover{filter:brightness(1.05);}
    .axm-ok.axm-danger{background:linear-gradient(135deg,#dc2626,#ef4444);box-shadow:0 4px 12px rgba(220,38,38,.35);}
    @keyframes axm-fade{from{opacity:0}to{opacity:1}}
    @keyframes axm-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
    html[data-theme="dark"] .axm-card{background:#131a2a;color:#e9f0fb;border-color:rgba(255,255,255,.1);}
    html[data-theme="dark"] .axm-msg{color:#c3cee0;}
    html[data-theme="dark"] .axm-cancel{border-color:rgba(255,255,255,.18);color:#c3cee0;}
    html[data-theme="dark"] .axm-cancel:hover{background:rgba(255,255,255,.06);}
    @media (prefers-color-scheme:dark){
      html:not([data-theme="light"]) .axm-card{background:#131a2a;color:#e9f0fb;border-color:rgba(255,255,255,.1);}
      html:not([data-theme="light"]) .axm-msg{color:#c3cee0;}
      html:not([data-theme="light"]) .axm-cancel{border-color:rgba(255,255,255,.18);color:#c3cee0;}
    }`;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function open(opts) {
    ensureStyle();
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "axm-overlay";
      var card = document.createElement("div");
      card.className = "axm-card";
      card.setAttribute("role", "alertdialog");
      card.setAttribute("aria-modal", "true");

      var html = "";
      if (opts.title) html += '<h2 class="axm-title"></h2>';
      html += '<p class="axm-msg"></p><div class="axm-actions"></div>';
      card.innerHTML = html;
      if (opts.title) card.querySelector(".axm-title").textContent = opts.title;
      card.querySelector(".axm-msg").textContent = opts.message || "";

      var actions = card.querySelector(".axm-actions");
      function finish(val) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(val);
      }
      if (!opts.hideCancel) {
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "axm-btn axm-cancel";
        cancel.textContent = opts.cancelText || "Cancel";
        cancel.onclick = function () { finish(false); };
        actions.appendChild(cancel);
      }
      var ok = document.createElement("button");
      ok.type = "button";
      ok.className = "axm-btn axm-ok" + (opts.danger ? " axm-danger" : "");
      ok.textContent = opts.confirmText || "OK";
      ok.onclick = function () { finish(true); };
      actions.appendChild(ok);

      overlay.appendChild(card);
      overlay.addEventListener("mousedown", function (e) {
        if (e.target === overlay) finish(false);
      });
      function onKey(e) {
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter") { e.preventDefault(); finish(true); }
      }
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      ok.focus();
    });
  }

  window.axusConfirm = function (message, opts) {
    opts = opts || {};
    return open({
      message: message,
      title: opts.title,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      danger: opts.danger,
    });
  };
  window.axusAlert = function (message, opts) {
    opts = opts || {};
    return open({
      message: message,
      title: opts.title,
      confirmText: opts.okText || "OK",
      hideCancel: true,
    }).then(function () {});
  };
})();

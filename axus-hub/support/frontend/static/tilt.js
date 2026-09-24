/* Portal micro-interactions (portal only), all rAF-throttled + reduced-motion aware:
   1) pointer-follow 3D tilt + moving glare on [data-tilt] surfaces
   2) cursor spotlight that tracks across ticket cards
*/
(function () {
  try {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {}

  /* ---- 3D tilt + glare (login card, etc.) ---- */
  var MAX = 7; // degrees
  function bindTilt(el) {
    var raf = 0, lx = 0, ly = 0, gx = 50, gy = 50;
    el.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      lx = px * MAX; ly = -py * MAX;
      gx = (px + 0.5) * 100; gy = (py + 0.5) * 100;
      el.classList.add("is-tilting");
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        el.style.transform = "perspective(1000px) rotateY(" + lx.toFixed(2) + "deg) rotateX(" + ly.toFixed(2) + "deg)";
        el.style.setProperty("--gx", gx.toFixed(1) + "%");
        el.style.setProperty("--gy", gy.toFixed(1) + "%");
      });
    });
    el.addEventListener("pointerleave", function () {
      el.style.transform = ""; el.classList.remove("is-tilting");
    });
  }

  /* ---- cursor spotlight across ticket cards (delegated on the list) ---- */
  function bindSpotlight(list) {
    var raf = 0, card = null, mx = 0, my = 0;
    list.addEventListener("pointermove", function (e) {
      var c = e.target.closest ? e.target.closest(".ticket-card") : null;
      if (!c) return;
      var r = c.getBoundingClientRect();
      card = c; mx = ((e.clientX - r.left) / r.width) * 100; my = ((e.clientY - r.top) / r.height) * 100;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (card) { card.style.setProperty("--mx", mx.toFixed(1) + "%"); card.style.setProperty("--my", my.toFixed(1) + "%"); }
      });
    });
  }

  function scan() {
    document.querySelectorAll("[data-tilt]:not([data-tilt-bound])").forEach(function (el) {
      el.setAttribute("data-tilt-bound", "1"); bindTilt(el);
    });
    document.querySelectorAll(".ticket-list:not([data-spot-bound])").forEach(function (el) {
      el.setAttribute("data-spot-bound", "1"); bindSpotlight(el);
    });
  }
  if (document.readyState !== "loading") scan();
  else document.addEventListener("DOMContentLoaded", scan);
})();

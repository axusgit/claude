/* Lightweight pointer-follow 3D tilt for elements marked [data-tilt] (portal only).
   rAF-throttled, resets on leave, disabled for reduced-motion. */
(function () {
  try {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {}
  var MAX = 7; // degrees

  function bind(el) {
    var raf = 0;
    el.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        el.style.transform =
          "perspective(1000px) rotateY(" + (px * MAX).toFixed(2) + "deg) rotateX(" +
          (-py * MAX).toFixed(2) + "deg)";
      });
    });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; });
  }

  function scan() {
    document.querySelectorAll("[data-tilt]:not([data-tilt-bound])").forEach(function (el) {
      el.setAttribute("data-tilt-bound", "1");
      bind(el);
    });
  }
  if (document.readyState !== "loading") scan();
  else document.addEventListener("DOMContentLoaded", scan);
})();

/* ===================================================================
   Horizon Symmetry — case study

   The rail does not scroll, so the folds in it read the gallery beside
   them: each one takes over as the work passes a mark, and closes back
   on the way up. Nothing has to be clicked.

   Clicking still works, and it works the same way — a click does not
   just open a fold, it pans the page to the exact place that fold would
   have opened on its own. The two ways of driving it stay in agreement.

   This runs both for a real case page and for one opened in place from
   the landing page, so it takes a root and can be torn down again.
   =================================================================== */

window.CaseView = (function () {
  "use strict";

  var live = null;         // listeners belonging to the case view on screen

  var ARRIVE = "cubic-bezier(0.22, 0.72, 0.24, 1)";   // one easing for every arrival

  /* Two-stage arrivals. A thing slides in from nothing, and by the time it
     is in place it is only most of the way lit; the last of the opacity
     comes up after it has stopped. Nothing lands at full strength on the
     same frame it stops moving, which is what made the old entrance feel
     abrupt even when the travel itself was eased. */
  var SETTLED = 0.68;      // share of the run spent travelling
  var ARRIVAL = 0.82;      // how lit it is at that point

  var still = window.matchMedia &&
              matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init(root) {
    root = root || document;

    var gallery = root.querySelector(".gallery");
    var folds   = Array.prototype.slice.call(root.querySelectorAll(".fold"));
    if (live) live.stop();
    if (!gallery || !folds.length) return;

  // where in the gallery's travel each fold takes over
  var MARKS = [0, 0.28, 0.55, 0.80];
  var BAND  = 0.035;          // hysteresis, so a boundary cannot flutter
  var ANCHOR = 0.45;          // the viewport line the progress is read against

  var PAN = 750;              // ms for a click to travel to its fold

  var open    = -1;
  var ticking = false;
  var panning = false;        // a click-pan owns the scroll
  var raf     = 0;

  function progress() {
    var r = gallery.getBoundingClientRect();
    if (!r.height) return 0;
    return Math.min(1, Math.max(0, (innerHeight * ANCHOR - r.top) / r.height));
  }

  /* The inverse of progress(): the scroll position at which `u` is true.
     This is what makes a click land where scrolling would have. */
  function scrollFor(u) {
    var r = gallery.getBoundingClientRect();
    return r.top + scrollY + u * r.height - innerHeight * ANCHOR;
  }

  function current() {
    var u = progress();
    var i = 0;
    for (var k = 0; k < MARKS.length && k < folds.length; k++) {
      // leaving a fold costs a little more than entering it
      var edge = MARKS[k] + (k > open ? BAND : -BAND);
      if (u >= edge) i = k;
    }
    return i;
  }

  function show(i) {
    if (i === open) return;
    open = i;
    folds.forEach(function (f, k) {
      f.classList.toggle("is-open", k === i);
      f.querySelector(".fold__head")
       .setAttribute("aria-expanded", k === i ? "true" : "false");
    });
  }

  function sync() {
    ticking = false;
    if (panning) return;      // the pan owns the folds until it settles
    show(current());
  }

  function onScroll() {
    if (panning || ticking) return;
    ticking = true;
    requestAnimationFrame(sync);
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", sync);

  live = {
    stop: function () {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", sync);
      cancelAnimationFrame(raf);
      if (watch) watch.disconnect();
      live = null;
    }
  };

  /* The pan is driven here rather than handed to scroll-behavior: smooth.
     Native smooth scrolling is refused outright in some setups, and a pan
     that silently does nothing would leave the clicked fold open over a
     gallery that never moved. Owning the animation keeps the two in step. */
  function panTo(target) {
    var start = scrollY;
    var delta = target - start;
    var t0 = 0;

    cancelAnimationFrame(raf);

    if (still || Math.abs(delta) < 2) {
      scrollTo(0, target);
      panning = false;
      show(current());
      return;
    }

    panning = true;

    raf = requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / PAN);
      scrollTo(0, start + delta * (1 - Math.pow(1 - p, 3)));   // ease-out cubic

      if (p < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      raf = 0;
      panning = false;
      show(current());
    });
  }

  // any real input cancels the pan and hands the scroll back
  ["wheel", "touchstart", "keydown"].forEach(function (ev) {
    addEventListener(ev, function () {
      if (!panning) return;
      cancelAnimationFrame(raf);
      raf = 0;
      panning = false;
      show(current());
    }, { passive: true });
  });

  folds.forEach(function (f, k) {
    f.querySelector(".fold__head").addEventListener("click", function () {
      show(k);
      // land just past the mark, so the fold stays open once the pan lands
      panTo(Math.max(0, scrollFor(MARKS[k] + BAND + 0.01)));
    });
  });

    show(0);
    sync();
    reveal(root, gallery);
    settle(root);
  }

  /* Everything that is not a frame arrives from the right, the side of
     the screen the rail sits on, row by row, so the rail assembles rather
     than appearing. The open fold comes in whole: nothing flies into it
     from the landing page any more, so there is no landing to protect. */
  function settle(root) {
    if (still) return;

    var bar = root.querySelector(".bar");
    if (bar) {
      bar.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 520, delay: 60, fill: "backwards", easing: ARRIVE });
    }

    var rows = [];
    var head = root.querySelector(".rail__head");
    if (head) rows.push(head);

    Array.prototype.forEach.call(root.querySelectorAll(".fold"), function (f) {
      rows.push(f);
    });

    var up = root.querySelector(".upnext");
    if (up) rows.push(up);

    rows.forEach(function (el, i) {
      if (!el) return;
      el.animate(
        [ { opacity: 0, transform: "translateX(54px)", offset: 0, easing: ARRIVE },
          { opacity: ARRIVAL, transform: "translateX(0px)", offset: SETTLED },
          { opacity: 1, transform: "translateX(0px)", offset: 1 } ],
        { duration: 1180, delay: 170 + i * 105, fill: "backwards" });
    });
  }

  /* --- the frames arriving -------------------------------------------- */

  var watch = null;

  /* Photo 01 is never animated: on an in-place open it is the frame the
     cover has just flown into, and moving it would undo that landing. The
     rest rise into place — the ones already on screen in one staggered
     run just after the flight lands, the ones further down as they are
     reached.

     `fill: backwards` holds each frame at the first keyframe through its
     delay, so nothing has to be hidden in CSS and a page without
     scripting still shows everything. */
  function rise(shot, delay) {
    if (shot.__risen) return;
    shot.__risen = true;
    if (still) return;
    shot.animate(
      [ { opacity: 0, transform: "translateY(58px)", offset: 0, easing: ARRIVE },
        { opacity: 0.85, transform: "translateY(0px)", offset: SETTLED },
        { opacity: 1, transform: "translateY(0px)", offset: 1 } ],
      { duration: 1240, delay: delay, fill: "backwards" });
  }

  function reveal(root, gallery) {
    var shots = Array.prototype.slice.call(root.querySelectorAll(".shot"));
    var near = [], far = [];

    shots.forEach(function (s) {
      if (s.querySelector(".shot__cover")) { s.__risen = true; return; }
      (s.getBoundingClientRect().top < innerHeight ? near : far).push(s);
    });

    near.forEach(function (s, i) { rise(s, 210 + i * 155); });

    if (!far.length || !window.IntersectionObserver) {
      far.forEach(function (s) { rise(s, 0); });
      return;
    }

    watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        rise(e.target, 0);
        watch.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

    far.forEach(function (s) { watch.observe(s); });
  }

  // a real case page starts itself; one opened in place is started by handoff.js
  if (document.querySelector(".gallery")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { init(document); });
    } else {
      init(document);
    }
  }

  return { init: init };
})();

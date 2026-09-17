/* ===================================================================
   Horizon Symmetry — entrance loader

   The hero is a Unicorn Studio scene, and building it is a chain of
   three round trips before a single pixel can be drawn: the library
   from jsDelivr, the scene from storage.googleapis.com, then its
   textures from assets.unicorn.studio. Measured on a wide desktop that
   was around seven seconds, and for all of it the page was a headline
   on a black field, which reads as broken rather than as loading.

   So the wait is given a face. A mark, a line that fills against real
   stages rather than against a timer, and a single fade out into the
   finished hero.

   Nothing here may ever strand the page. Every path ends at finish(),
   including a hard cap, and if this file fails to parse at all the
   overlay is removed by its own CSS fallback and the site behaves
   exactly as it did before.
   =================================================================== */

(function () {
  "use strict";

  var el = document.getElementById("loader");
  if (!el) return;

  var fill = el.querySelector(".loader__fill");
  var scene = document.querySelector(".hero__scene");
  var shown = 0;          // what the bar is showing
  var done = false;
  var start = Date.now();

  /* The bar only ever moves forward. A stage that resolves out of order,
     or twice, can never pull it backwards. */
  function set(v) {
    if (v <= shown) return;
    shown = v > 1 ? 1 : v;
    if (fill) fill.style.width = (shown * 100) + "%";
  }

  function finish() {
    if (done) return;
    done = true;
    set(1);

    /* Let the bar arrive before the curtain moves, or the fill reads as
       having been decorative. */
    setTimeout(function () {
      el.classList.add("is-done");

      /* The headline entrance is CSS, gated on body.is-ready, and by now
         it has almost certainly already played behind the overlay. Taking
         the class off and putting it back on the next frame replays it,
         so the type arrives with the artwork instead of being revealed
         already finished. Harmless if it was never set. */
      var b = document.body;
      b.classList.remove("is-ready");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { b.classList.add("is-ready"); });
      });

      /* Out of the layer tree once it has faded, so it can never take a
         click or cost a paint. */
      setTimeout(function () { el.classList.add("is-gone"); }, 1000);
    }, 200);
  }

  /* --- the stages -----------------------------------------------------

     Real milestones, not a timer pretending to be one. The phone is not
     shown the scene at all (styles.css), so there it has nothing to wait
     for beyond its own hero frame and the window load event. */

  set(0.16);                                   // parsed, styled, fonts requested

  var wantsScene = scene && getComputedStyle(scene).display !== "none";

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { set(wantsScene ? 0.34 : 0.7); });
  }

  addEventListener("load", function () { set(wantsScene ? 0.5 : 0.94); });

  if (!wantsScene) {
    /* No scene to build. The hero here is one background frame, and the
       load event above covers it. Keep it brief. */
    setTimeout(finish, 900);
  } else {
    /* Polled rather than hooked, so the embed loader in index.html stays
       the vendor's own code. window.UnicornStudio appears when the
       library has parsed; the canvas appears when the scene is built. */
    var canvasSeen = 0;
    (function poll() {
      if (done) return;

      if (window.UnicornStudio) set(0.55);

      var c = scene.querySelector("canvas");
      if (c) {
        if (!canvasSeen) canvasSeen = Date.now();
        set(0.8);
        /* The scene fades itself up over roughly a second after the canvas
           lands. Riding that out means the curtain lifts onto artwork
           rather than onto the first black frame of it. */
        var since = Date.now() - canvasSeen;
        set(0.8 + Math.min(since / 1100, 1) * 0.2);
        if (since > 1100) return finish();
      }

      requestAnimationFrame(poll);
    })();
  }

  /* The cap. A blocked CDN, a WebGL context that never comes back, a
     network that stalls: none of them are allowed to hold the page. */
  setTimeout(finish, 5000);

  /* A second belt: if anything above threw after the overlay was shown,
     this still clears it. */
  setTimeout(function () {
    if (!done) finish();
    el.classList.add("is-gone");
  }, 8000);

  void start;
})();

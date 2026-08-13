/* ===================================================================
   Horizon Symmetry — hero

   The reveal itself is a Unicorn Studio scene, initialised by the
   loader in index.html. All this does is release the entrance
   animation once the fonts are in, so the headline never plays its
   line-reveal in a fallback face and then reflow.
   =================================================================== */

(function () {
  "use strict";

  var done = false;
  function ready() {
    if (done) return;
    done = true;
    document.body.classList.add("is-ready");
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(ready);
    setTimeout(ready, 1200); // never let a slow font hold the page hostage
  } else {
    ready();
  }

  /* --- keeping the scene alive --------------------------------------

     Unicorn Studio measures the scene's box once and maps the cursor
     against that measurement. Two things here invalidate it:

       - opening a project, which puts the whole landing page to
         display: none, so for as long as the case view is up the hero
         has no box at all;
       - a backgrounded tab, where the library cancels its frame loop
         and picks it back up on return.

     Either way the scene comes back painting but deaf to the cursor,
     because the box it is still doing pointer maths against is the one
     it measured while the hero was not on screen. There is no public
     API for this, but its resize handler re-measures every live scene,
     so a synthetic resize is the entire repair. Desktop listens on
     resize and touch on orientationchange, hence both.

     Two frames of delay: one for the display to come back, one for the
     layout that follows it. Measuring any earlier measures nothing. */
  function remeasure() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        dispatchEvent(new Event("resize"));
        dispatchEvent(new Event("orientationchange"));
      });
    });
  }

  addEventListener("hs:home", remeasure);      // a case view just closed
  addEventListener("pageshow", remeasure);     // restored from the back/forward cache
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) remeasure();
  });

  /* --- driving the reveal on a phone ---------------------------------

     The scene reveals whatever is under the cursor, and a phone has no
     cursor. A finger is not a substitute: the only drag available on the
     hero is the one that scrolls the page, so the scene is taken out of
     the hit test entirely (pointer-events: none, in styles.css) and
     driven from here instead.

     The scene has no API for its pointer, but it has never needed one —
     it reads the mouse off the events the page sends it. So the events
     are sent: a slow orbit around the black hole, close enough to it
     that the violet never leaves the screen, wide enough that the light
     keeps moving across the disc. Dispatching bypasses hit testing, so
     the scene stays untouchable and still gets its pointer.

     Off screen or in a background tab it stops: the library is not
     drawing then either. */

  var HOLE_X = 0.485;   // the black hole, as a share of the scene box
  var HOLE_Y = 0.45;
  var SWING_X = 0.14;   // how far the orbit travels from it
  var SWING_Y = 0.085;

  var scene = document.querySelector(".hero__scene");
  var coarse = window.matchMedia &&
               !matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!scene || !coarse) return;

  var raf = 0, near = false, entered = false;

  function send(type, x, y, Ctor, extra) {
    var target = scene.querySelector("canvas") || scene;
    var init = { bubbles: true, cancelable: true, view: window,
                 clientX: x, clientY: y, screenX: x, screenY: y };
    for (var k in extra) init[k] = extra[k];
    try { target.dispatchEvent(new Ctor(type, init)); } catch (e) { /* noop */ }
  }

  function move(now) {
    raf = 0;
    var r = scene.getBoundingClientRect();
    if (r.width && r.height) {
      var t = now / 1000;
      /* two frequencies per axis, none of them a multiple of another, so
         the path never repeats visibly and never sits still */
      var x = HOLE_X + SWING_X * (0.72 * Math.sin(t * 0.31) + 0.28 * Math.sin(t * 0.83));
      var y = HOLE_Y + SWING_Y * (0.72 * Math.cos(t * 0.24) + 0.28 * Math.sin(t * 0.67));

      var cx = r.left + x * r.width;
      var cy = r.top  + y * r.height;

      if (!entered) {
        entered = true;
        send("pointerover", cx, cy, window.PointerEvent || MouseEvent,
             { pointerId: 1, pointerType: "mouse", isPrimary: true });
        send("mouseover", cx, cy, MouseEvent);
        send("mouseenter", cx, cy, MouseEvent);
      }
      send("pointermove", cx, cy, window.PointerEvent || MouseEvent,
           { pointerId: 1, pointerType: "mouse", isPrimary: true });
      send("mousemove", cx, cy, MouseEvent);
    }
    if (near && !document.hidden) raf = requestAnimationFrame(move);
  }

  function run() {
    if (raf || !near || document.hidden) return;
    raf = requestAnimationFrame(move);
  }

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      near = entries[0].isIntersecting;
      if (near) run();
    }, { threshold: 0 }).observe(scene);
  } else {
    near = true;
  }

  document.addEventListener("visibilitychange", run);
  addEventListener("hs:home", run);             // the hero is back on screen
  run();
})();

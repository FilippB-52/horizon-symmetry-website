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
})();

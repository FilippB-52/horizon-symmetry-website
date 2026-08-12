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
})();

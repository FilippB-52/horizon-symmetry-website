/* ===================================================================
   Horizon Symmetry — the page is a fixed surface

   Every scene on the page is drawn against the viewport it was handed:
   the hero canvas, the pinned work stage, the particle field. Pinching
   or dragging the page sideways moves all of that under artwork that
   has already been measured, so none of it is allowed. The page scrolls
   vertically and does nothing else.

   Most of the lock is CSS — touch-action, overscroll-behavior and
   user-select in styles.css. What is left is the part iOS Safari only
   answers to in script: it has ignored `user-scalable=no` since iOS 10,
   and a pinch arrives there as a gesture event that has to be refused.
   =================================================================== */

(function () {
  "use strict";

  ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); },
                              { passive: false });
  });

  /* A second finger is a zoom on every touch browser. touch-action covers
     the ones that honour it on the document; this covers the rest. */
  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
})();

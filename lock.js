/* ===================================================================
   Horizon Symmetry — the page does not zoom

   Every scene here is measured against the viewport it was handed, so a
   zoomed page is a broken one: the pinned sections, the particle field
   and the hero frame are all laid out against a box that has stopped
   being the screen.

   What this does *not* do is cap the scale. `maximum-scale` and
   `user-scalable=no` are ignored by iOS Safari, so they never stop the
   pinch — they only refuse the pinch back, which is how a phone ends up
   stranded at a zoom with no gesture left to undo it. That was the bug.

   So the gesture is refused at its start instead, before any scale
   happens. Nothing to undo, because nothing moves. `touch-action:
   manipulation` in styles.css takes the double tap, which is the other
   way in.

   Trade-off worth naming: this takes pinch-to-zoom away from everyone,
   which is a real accessibility cost. The browser's own page zoom (the
   Aa menu on iOS, ⌘+ elsewhere) is untouched and still works.
   =================================================================== */

(function () {
  "use strict";

  /* Safari's pinch. Refusing the start cancels the whole gesture. */
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); },
                              { passive: false });
  });

  /* Everywhere else a second finger is the zoom, and touch-action only
     covers the browsers that honour it on the document. */
  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  /* A double tap on text can still zoom on iOS. Refused only when it is
     genuinely a second tap inside 300ms and lands on nothing tappable —
     cancelling a touchend cancels the click that would have followed it,
     and no zoom is worth swallowing a tap on a project. */
  var last = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    var t = e.target;
    var live = t && t.closest && t.closest("a, button, input, textarea, select, label");
    if (!live && now - last < 300 && e.touches.length === 0) e.preventDefault();
    last = now;
  }, { passive: false });
})();

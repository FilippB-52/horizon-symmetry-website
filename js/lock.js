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

  /* There used to be a non-passive touchmove listener here, refusing a
     second finger. It was the scroll bug. A non-passive touchmove on the
     document means the browser cannot start a scroll until script has had
     its say on every single move, so iOS drops off its threaded scroller
     and runs the whole gesture on the main thread. The page then trails
     the finger and fights the flick. touch-action in styles.css is now
     pan-x pan-y, which refuses the pinch declaratively and costs nothing,
     so the listener is gone rather than made passive. */

  /* A double tap on text can still zoom on iOS. Refused only when it is
     genuinely a second tap inside 300ms and lands on nothing tappable —
     cancelling a touchend cancels the click that would have followed it,
     and no zoom is worth swallowing a tap on a project. */
  var last = 0;
  var moved = false;

  /* A flick is a touch that travelled. Two flicks in quick succession met
     every test for a double tap, so the second one had its touchend
     cancelled, and cancelling touchend on iOS kills the momentum the flick
     had just earned — scroll, scroll again, and the page stops dead under
     you. A tap that never moved is the only thing that can be a double
     tap, so that is the only thing now considered. */
  document.addEventListener("touchstart", function () {
    moved = false;
  }, { passive: true });

  document.addEventListener("touchmove", function () {
    moved = true;
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    var t = e.target;
    var live = t && t.closest && t.closest("a, button, input, textarea, select, label");
    if (!moved && !live && now - last < 300 && e.touches.length === 0) e.preventDefault();
    last = now;
  }, { passive: false });
})();

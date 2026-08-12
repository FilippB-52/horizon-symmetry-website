/* ===================================================================
   Horizon Symmetry — the menu

   The panel is `hidden` at rest rather than merely transparent, so it is
   never an invisible sheet in front of the hero swallowing clicks, and
   its links stay out of the tab order until they are actually on screen.

   Opening unhides it, then flips the class on the next frame so the
   transition has two states to move between. Closing waits for the fade
   before hiding again.
   =================================================================== */

(function () {
  "use strict";

  var burger = document.querySelector(".burger");
  var menu   = document.getElementById("menu");
  if (!burger || !menu) return;

  var FADE = 450;   // must outlast the opacity transition in styles.css
  var open = false;
  var timer = 0;
  var lastFocus = null;

  function setOpen(next) {
    if (next === open) return;
    open = next;
    clearTimeout(timer);
    burger.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-open", open);

    if (open) {
      lastFocus = document.activeElement;
      menu.hidden = false;
      /* The transition needs a start state to move from, so the unhide has
         to be flushed before the class lands. Reading a layout property
         does that synchronously — waiting on requestAnimationFrame leaves
         the panel unhidden but transparent if frames are throttled, which
         is an invisible sheet that still takes clicks. */
      void menu.offsetHeight;
      menu.classList.add("is-open");
      var first = menu.querySelector("a");
      if (first) first.focus({ preventScroll: true });
    } else {
      menu.classList.remove("is-open");
      timer = setTimeout(function () { menu.hidden = true; }, FADE);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
  }

  burger.addEventListener("click", function () { setOpen(!open); });

  // Any link closes it: the in-page ones only move the scroll, so the
  // panel would otherwise stay up over the section it just jumped to.
  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) setOpen(false);
  });

  // Keep the tab ring inside the panel while it is up.
  menu.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || !open) return;
    var items = menu.querySelectorAll("a");
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      burger.focus();
    }
  });
})();

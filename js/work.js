/* ===================================================================
   Horizon Symmetry — selected work

   The stage is pinned by CSS and never moves. What moves is the deck:
   the cards are stacked in depth, and scrolling slides the whole stack
   upward one card at a time. The card in front sits centred and fully
   lit; its neighbours hang above and below it, pushed back along z and
   dimmed, so the one you are reading reads as nearer than the rest.

   Depth is real rather than drawn — the deck carries the perspective and
   each card is translated along z, so the shrink comes from the
   projection instead of a scale pretending to be one.

   The copy beside it rolls in character by character whenever the front
   card changes.
   =================================================================== */

(function () {
  "use strict";

  var section = document.querySelector(".work");
  if (!section) return;

  var track  = section.querySelector(".work__track");
  var stage  = section.querySelector(".work__stage");
  var deck   = section.querySelector(".deck");
  var copy   = section.querySelector(".work__copy");
  var cards  = Array.prototype.slice.call(section.querySelectorAll(".card"));
  var panels = Array.prototype.slice.call(section.querySelectorAll(".project"));
  if (!track || !stage || !deck || cards.length < 2) return;

  var N = cards.length;

  /* --- which section this is ----------------------------------------

     On a phone the stylesheet lays the covers out as a plain column and
     says so here. None of the deck below runs then: nothing is pinned,
     nothing is switched, no cover is written to. All that is left is
     saying which project the description belongs to, and scroll answers
     that on its own. The mode is re-read on resize, so a window crossing
     the breakpoint hands over rather than leaving stale inline styles on
     cards the stylesheet is now placing itself. */

  function isGallery() {
    return getComputedStyle(deck).getPropertyValue("--deck-mode").trim() === "gallery";
  }

  var gallery = isGallery();

  function releaseCards() {
    cards.forEach(function (el) {
      el.style.cssText = "";
      el.classList.remove("is-current");
      el.classList.add("is-sharp");     // the photograph, not the blocks
    });
  }

  /* The description belongs to the last cover whose top has gone under
     the copy block. Reading it as "has passed" rather than "is nearest"
     means the answer only ever moves one way as you scroll, so a cover
     sitting across the line cannot flicker the copy between two. */
  var spyRaf = 0;

  function spy() {
    spyRaf = 0;
    var under = copy ? copy.getBoundingClientRect().bottom : 0;
    var line = under + (window.innerHeight - under) * 0.5;
    var i = 0;
    for (var k = 0; k < N; k++) {
      if (cards[k].getBoundingClientRect().top <= line) i = k;
    }
    setCopy(i);
  }

  function spyLater() {
    if (!spyRaf) spyRaf = requestAnimationFrame(spy);
  }

  /* --- tuning ------------------------------------------------------- */

  var GAP    = 0.075;   // space between stacked cards, as a share of the deck
  var LIFT   = 130;     // px each card is pushed back per step away
  var DIM    = 0.68;    // how much of its opacity a neighbour gives up
  var VANISH = 1.7;     // distance at which a card is gone entirely
  var DUR    = 800;     // ms for one card change, start to finish
  var CATCH  = 300;     // ms per card while catching up to a fast scroll
  var COLS   = 26;      // blocks across a card while it waits its turn
  var REVEAL = 1100;    // ms for a card to resolve once it has arrived
  var CURVE  = 1.7;     // >1 holds the blocks on screen; see pxResolve
  var EDGE   = 0.58;    // how far past a boundary before it counts as a switch

  /* Two behaviours are switched off here rather than cut out, so either
     comes back by flipping one word.

     SNAP true is the deck that only ever rests on a whole card: scroll
     chose which one, and getting there was a fixed animation. It reads as
     deliberate and it is also what made a small gesture cost a whole
     project, with nowhere to stand in between. False lets scroll carry
     the deck directly and leaves GLIDE as the only weight in it.

     BLOCKS true is the coarse pixel reveal every cover waited behind. */
  var SNAP   = false;
  var BLOCKS = false;
  var GLIDE  = 0.16;    // share of the distance closed per frame, SNAP off

  var TEXT_SPAN = 560;  // ms the copy cascade takes
  var ROLLS     = 2;    // scrambled glyphs each character rolls through
  var EASE_OUT  = "cubic-bezier(0.215, 0.61, 0.355, 1)";   // power3.out
  var CHARSET   = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&$@";

  var still = window.matchMedia &&
              matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- the copy ----------------------------------------------------- */

  /* Split a body into per-character spans, keeping words whole so lines
     still break where they always did. Returns the characters in reading
     order; whitespace stays plain text. */
  function splitChars(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], chars = [], node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(function (n) {
      var text = n.nodeValue.replace(/\s+/g, " ").trim();
      if (!text) return;
      var frag = document.createDocumentFragment();

      text.split(" ").forEach(function (word, wi) {
        if (wi) frag.appendChild(document.createTextNode(" "));
        if (!word) return;
        var holder = document.createElement("span");
        holder.className = "sfl-word";
        for (var i = 0; i < word.length; i++) {
          var c = document.createElement("span");
          c.className = "sfl-char";
          c.textContent = word[i];
          holder.appendChild(c);
          chars.push(c);
        }
        frag.appendChild(holder);
      });

      n.parentNode.replaceChild(frag, n);
    });

    return chars;
  }

  /* Every character becomes a clipped slot holding [real, scramble…].
     Parked ROLLS slots to the left, the slot shows noise; slid home, it
     shows the character. Widths are read in one pass before anything is
     written, so the whole build costs a single layout. */
  function buildStrips(chars) {
    var widths = chars.map(function (c) { return c.getBoundingClientRect().width; });
    var strips = [];

    chars.forEach(function (c, i) {
      var w = widths[i];
      if (!w) return;

      var slot = document.createElement("span");
      slot.className = "sfl-slot";
      slot.style.width = w + "px";

      var strip = document.createElement("span");
      strip.className = "sfl-strip";

      var real = c.cloneNode(true);
      real.style.width = w + "px";
      strip.appendChild(real);

      for (var k = 0; k < ROLLS; k++) {
        var s = document.createElement("span");
        s.className = "sfl-char";
        s.style.width = w + "px";
        s.textContent = CHARSET.charAt((Math.random() * CHARSET.length) | 0);
        strip.appendChild(s);
      }

      strip.style.transform = "translate3d(" + (-ROLLS * w) + "px,0,0)";
      strip.__w = w;

      slot.appendChild(strip);
      c.parentNode.replaceChild(slot, c);
      strips.push(strip);
    });

    return strips;
  }

  /* Odd characters go first and the evens follow at 70% of that pass, the
     interleave the reference uses. Durations are derived from the budget
     rather than fixed, so a long paragraph and a short one take the same
     time instead of the long one running on. */
  function roll(strips) {
    var budget = TEXT_SPAN;
    var unit   = budget / 1.7;          // 1.7 = the even pass overlapping at 0.7
    var dur    = unit * 0.75;
    var spread = unit * 0.25;

    var odd = [], even = [];
    strips.forEach(function (s, i) { (i % 2 ? odd : even).push(s); });

    var evenStart = odd.length ? 0.7 * (dur + spread) : 0;

    function go(list, offset) {
      var step = list.length > 1 ? spread / (list.length - 1) : 0;
      list.forEach(function (strip, i) {
        strip.style.transition = "transform " + dur + "ms " + EASE_OUT +
                                 " " + (offset + i * step) + "ms";
        strip.style.transform = "translate3d(0,0,0)";
      });
    }

    if (strips.length) void strips[0].offsetWidth;   // commit the parked state
    go(odd, 0);
    go(even, evenStart);

    // once home, drop the scrambles: the resting paragraph is plain spans
    return setTimeout(function () {
      strips.forEach(function (strip) {
        var real = strip.firstElementChild;
        if (real) strip.replaceChildren(real);
        strip.style.transition = "";
        strip.style.transform = "none";
        strip.style.willChange = "auto";
      });
    }, evenStart + dur + spread + 60);
  }

  var timers = [];   // per panel: [cleanup timer, restore timer]
  var settle = 0;    // gallery: the roll waiting to see if scroll has stopped

  function clearTimers(i) {
    if (timers[i]) timers[i].forEach(clearTimeout);
    timers[i] = [];
  }

  /* Off until the stage is actually on screen, so the first project's copy
     is simply there on load and rolls in when it is reached. */
  var armed = false;

  function shuffleIn(i) {
    var panel = panels[i];
    var body  = panel.querySelector(".project__body");
    if (!body || still || !armed) return;

    clearTimers(i);
    if (panel.__html == null) panel.__html = body.innerHTML;
    else body.innerHTML = panel.__html;

    timers[i] = [roll(buildStrips(splitChars(body)))];
  }

  /* Put a hidden panel back to plain markup — cheaper to leave lying
     around, and it re-measures cleanly next time it is asked to play. */
  function restore(i) {
    var panel = panels[i];
    var body  = panel.querySelector(".project__body");
    clearTimers(i);
    if (body && panel.__html != null) body.innerHTML = panel.__html;
  }

  function setCopy(i) {
    if (i === shown) return;
    var prev = shown;
    shown = i;

    for (var k = 0; k < panels.length; k++) {
      panels[k].classList.toggle("is-active", k === i);
    }
    /* Cards the deck is only passing through on its way to a distant one
       get their copy plainly: the shuffle measures every character, and
       running it four times inside one catch-up buys nothing legible.

       A flick through the gallery is the same situation without a deck to
       ask, so the answer comes from waiting instead: the roll is held for
       a moment and only plays if the copy is still the one that asked for
       it. The wait is shorter than the fade it happens under. */
    if (i >= 0) {
      if (!gallery) {
        if (i === wanted) shuffleIn(i);
      } else {
        clearTimeout(settle);
        settle = setTimeout(function () { if (shown === i) shuffleIn(i); }, 60);
      }
    }
    if (prev >= 0 && prev !== i) {
      timers[prev] = (timers[prev] || []).concat(
        setTimeout(function () { restore(prev); }, 320)   // after its fade
      );
    }
  }

  /* --- pixelation ---------------------------------------------------- */

  /* Every card waits its turn as a block of coarse pixels and only
     resolves once it has actually arrived in front. The trick that keeps
     this cheap: the canvas buffer is sized to the block count, not to the
     card, so a waiting card costs about 26x16 pixels. Growing the buffer
     is the whole animation. */

  function pxInit(el) {
    var img = el.querySelector("img");
    if (!img) return;
    var c = document.createElement("canvas");
    c.className = "card__px";
    c.setAttribute("aria-hidden", "true");
    el.insertBefore(c, img);
    el.__px = { img: img, c: c, ctx: c.getContext("2d"), cols: 0, raf: 0, t0: 0 };
  }

  /* Redraw at `cols` blocks across, reproducing the object-fit: cover
     crop the image would have had, so the blocks line up with the photo
     the card resolves into. */
  function pxDraw(st, cols) {
    var img = st.img;
    var w = st.c.offsetWidth, h = st.c.offsetHeight;
    if (!img.naturalWidth || !w || !h) return;

    var rows = Math.max(1, Math.round(cols * h / w));
    if (st.c.width !== cols || st.c.height !== rows) {
      st.c.width = cols;
      st.c.height = rows;
    }

    var s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    var sw = w / s, sh = h / s;
    st.ctx.imageSmoothingEnabled = true;      // downscale should average
    st.ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2,
                     sw, sh, 0, 0, cols, rows);
    st.cols = cols;
  }

  function pxCoarse(el) {
    var st = el.__px;
    if (!st) return;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    st.t0 = 0;
    el.classList.remove("is-sharp");
    if (st.cols !== COLS) pxDraw(st, COLS);
  }

  function pxResolve(el) {
    var st = el.__px;
    if (!st || still) { if (el) el.classList.add("is-sharp"); return; }
    if (st.raf) cancelAnimationFrame(st.raf);
    st.t0 = 0;
    el.classList.remove("is-sharp");

    /* One block per CSS pixel is where the canvas becomes indistinguishable
       from the image, so that is where it hands over — anything less and
       the swap pops. */
    var cross = Math.max(320, Math.min(1600, st.c.offsetWidth || 900));

    st.raf = requestAnimationFrame(function step(now) {
      st.raf = 0;
      if (!st.t0) st.t0 = now;
      var p = Math.min(1, Math.max(0, (now - st.t0) / REVEAL));

      /* The count grows geometrically, so block size falls at a steady
         rate rather than in one lurch. The exponent above 1 is the part
         that matters: eased *out*, the run reaches single-pixel blocks
         in its first third and the rest of it is invisible, which reads
         as one huge jump straight to the photo. Easing in keeps real
         blocks on screen for most of the run and resolves at the end. */
      var e = Math.pow(p, CURVE);
      pxDraw(st, Math.round(COLS * Math.pow(cross / COLS, e)));

      if (p < 1) { st.raf = requestAnimationFrame(step); return; }
      el.classList.add("is-sharp");                       // hand over to the image
    });
  }

  /* --- position ----------------------------------------------------- */

  /* Scroll does not drag the deck. It only answers which card should be
     in front; moving there is a fixed-length animation that always
     finishes. So the deck is either resting on a card or on its way to
     one, and stopping mid-scroll can never leave it parked between two. */

  var from   = 0;       // card the deck is resting on / leaving
  var to     = 0;       // card it is heading for; === from when idle
  var dur    = DUR;     // length of the run in flight
  var t0     = 0;       // clock origin, 0 until the run's first frame
  var u      = 0;       // where the deck actually is, 0 → N-1
  var wanted = 0;       // what scroll says should be in front
  var raf    = 0;       // pending frame id, 0 when none
  var shown  = -1;

  /* Where scroll puts us, as a float across the cards. */
  function readScroll() {
    var top    = track.getBoundingClientRect().top;
    var usable = track.offsetHeight - stage.offsetHeight;
    if (usable <= 0) return 0;
    var tail = stage.offsetHeight * 0.45;          // hold on the last card
    var seg  = Math.max(1, (usable - tail) / (N - 1));
    return Math.min(N - 1, Math.max(0, -top / seg));
  }

  /* Deliberately sticky: the boundary has to be cleared by EDGE before
     the switch fires, so a nudge around it cannot flutter. */
  function pick(x) {
    if (x > wanted + EDGE) return Math.min(N - 1, Math.round(x));
    if (x < wanted - EDGE) return Math.max(0, Math.round(x));
    return wanted;
  }

  function layout() {
    if (gallery) return;              // the stylesheet is placing the covers
    var step = cards[0].offsetHeight + deck.clientHeight * GAP;

    for (var i = 0; i < N; i++) {
      var el = cards[i];
      var d  = i - u;                 // signed distance from the front
      var a  = Math.abs(d);

      if (a > VANISH) {
        if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";

      // dims to DIM by one step away, then out to nothing by VANISH
      var k  = Math.min(1, a);
      var op = 1 - k * DIM;
      if (a > 1) op *= Math.max(0, (VANISH - a) / (VANISH - 1));

      el.style.transform = "translate3d(0," + (d * step).toFixed(2) + "px," +
                           (-k * LIFT).toFixed(2) + "px)";
      el.style.opacity = op.toFixed(3);
      el.style.zIndex = String(100 - Math.round(a * 20));
      var front = a < 0.5;
      el.classList.toggle("is-current", front);
      // a card that loses the front mid-resolve goes straight back to
      // blocks, rather than finishing its reveal on the way out
      if (BLOCKS && !front &&
          (el.classList.contains("is-sharp") || (el.__px && el.__px.raf))) {
        pxCoarse(el);
      }
    }

    // flips at the halfway point, which is where the copy hands over too
    setCopy(Math.max(0, Math.min(N - 1, Math.round(u))));
  }

  function frame(now) {
    /* Cleared first, always. `raf` means "a frame is pending" and nothing
       else — a stale one would freeze the deck with no way back. */
    raf = 0;

    // the rAF timestamp is the frame's start, which can predate the clock
    // read that scheduled it, so take the origin from the first frame
    if (!t0) t0 = now;
    var p = Math.min(1, Math.max(0, (now - t0) / dur));

    u = from + (to - from) * (1 - Math.pow(1 - p, 3));   // ease-out cubic
    try { layout(); } catch (e) { /* a bad frame must not kill the loop */ }

    if (p < 1) {
      raf = requestAnimationFrame(frame);
      return;
    }

    from = to;
    u = to;
    t0 = 0;
    try { layout(); } catch (e) { /* noop */ }

    if (wanted !== from) {
      start(wanted);                      // scroll moved on while we ran
    } else if (armed && BLOCKS) {
      pxResolve(cards[to]);               // arrived, and staying: resolve it
    }
  }

  /* With SNAP off the deck is not driven to a card at all: scroll says
     where it should be as a float, and each frame closes GLIDE of what is
     left. It can therefore rest anywhere, two covers included, and a small
     gesture moves it a small amount instead of spending a whole project. */
  function glide() {
    raf = 0;
    var target = readScroll();
    var d = target - u;
    if (Math.abs(d) < 0.001) {
      u = target;
      try { layout(); } catch (e) { /* a bad frame must not kill the loop */ }
      return;
    }
    u += d * GLIDE;
    try { layout(); } catch (e) { /* noop */ }
    raf = requestAnimationFrame(glide);
  }

  /* One card per move, never more.

     Sliding the whole deck straight to a distant card looked like the
     section breaking: `u` raced through the cards in between, and since
     anything further than VANISH is hidden, they each flashed in and
     vanished inside a single move. A flick now plays the projects in
     sequence instead, and frame() re-enters here on arrival until the
     deck has caught up with where scroll actually is.

     Catching up runs at CATCH rather than DUR, so a long run stays brisk
     instead of leaving the deck seconds behind the page. */
  /* Is any of the stage still on screen? */
  function onScreen() {
    var r = stage.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 0);
  }

  function start(target) {
    if (from !== to || target === from) return;

    /* A flick that clears the whole section leaves nobody to play the
       sequence to, and running it anyway is what makes the deck look like
       it is tearing itself apart on the way out. Off screen it simply
       arrives, so coming back finds the right card already in front. */
    if (!onScreen()) {
      from = to = u = target;
      t0 = 0;
      try { layout(); } catch (e) { /* noop */ }
      return;
    }

    var behind = Math.abs(target - from);
    to  = target > from ? from + 1 : from - 1;
    dur = behind > 1 ? CATCH : DUR;
    t0  = 0;
    raf = requestAnimationFrame(frame);
  }

  function onScroll() {
    if (gallery) { spyLater(); return; }
    if (!SNAP) { if (!raf) raf = requestAnimationFrame(glide); return; }
    var next = pick(readScroll());
    if (next !== wanted) {
      wanted = next;
      start(next);
    }
    // a move in flight must have a frame pending; if one ever stalled,
    // any scroll re-arms it rather than leaving the deck stuck
    if (from !== to && !raf) raf = requestAnimationFrame(frame);
  }

  /* --- boot --------------------------------------------------------- */

  if (gallery) {
    releaseCards();
    spy();

    // as on the deck: the copy is simply there until the section is
    // reached, and rolls from then on
    if (window.IntersectionObserver) {
      var gio = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        gio.disconnect();
        armed = true;
        shuffleIn(shown < 0 ? 0 : shown);
      }, { threshold: 0.35 });
      gio.observe(cards[0]);
    } else {
      armed = true;
    }
  } else {
    if (BLOCKS) {
      cards.forEach(pxInit);
      cards.forEach(function (el) {
        var st = el.__px;
        if (!st) return;
        if (st.img.complete && st.img.naturalWidth) pxCoarse(el);
        else st.img.addEventListener("load", function () { pxCoarse(el); }, { once: true });
      });
    } else {
      // nothing is waiting behind blocks, so every cover is simply itself —
      // and .is-sharp is what the stylesheet gates the covers on
      cards.forEach(function (el) { el.classList.add("is-sharp"); });
    }

    u = from = to = wanted = SNAP ? Math.round(readScroll()) : readScroll();
    layout();

    // the front card's copy rolls in when the stage arrives, not on load
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        armed = true;
        shuffleIn(shown < 0 ? 0 : shown);
        if (BLOCKS && from === to) pxResolve(cards[from]);
      }, { threshold: 0.5 });
      io.observe(stage);
    }
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", function () {
    var was = gallery;
    gallery = isGallery();                // the breakpoint may have changed

    for (var k = 0; k < panels.length; k++) restore(k);

    if (gallery) {
      if (!was) releaseCards();           // hand the covers back to the stylesheet
      spy();
      return;
    }

    if (BLOCKS) {
      cards.forEach(function (el) {
        if (el.__px && !el.classList.contains("is-sharp")) pxDraw(el.__px, el.__px.cols || COLS);
      });
    } else {
      cards.forEach(function (el) { el.classList.add("is-sharp"); });
    }
    if (was) { u = from = to = wanted = SNAP ? Math.round(readScroll()) : readScroll(); }
    onScroll();
    layout();
  });
})();

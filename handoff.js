/* ===================================================================
   Horizon Symmetry — opening a project

   A project does not load, it opens. The case page is fetched and put
   into this document rather than navigated to, so nothing is ever torn
   down: the cover and the copy fly from where the card had them to
   where the case page puts them, and the page they are flying into is
   already sitting underneath, waiting.

   That is the whole reason for doing it this way. A real navigation
   destroys the document at the moment the animation matters most, and
   no amount of easing survives that.

   The URL still changes, through history, so a project stays linkable
   and reloading it lands on the real static page.
   =================================================================== */

(function () {
  "use strict";

  var deck = document.querySelector(".deck");
  var home = document.querySelector("main");
  if (!deck || !home) return;

  // without these, every link is left to navigate the ordinary way
  if (!window.fetch || !document.body.animate || !window.history.pushState) return;

  var soft = !(window.matchMedia &&
               matchMedia("(prefers-reduced-motion: reduce)").matches);

  var DUR  = 720;
  var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  var pages = {};          // url → promise of html
  var view  = null;        // the case view currently in the document
  var title = document.title;
  var back  = 0;           // where the landing page was left
  var busy  = false;

  function load(url) {
    if (!pages[url]) {
      pages[url] = fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(); });
    }
    return pages[url];
  }

  /* --- building the case view ---------------------------------------- */

  function build(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var v = document.createElement("div");
    v.className = "case-view is-measuring";
    // scripts are not carried across; case.js is already here
    Array.prototype.forEach.call(doc.body.children, function (el) {
      if (el.tagName !== "SCRIPT") v.appendChild(document.importNode(el, true));
    });
    /* The case page hangs --accent off its <body>; the body here belongs
       to the landing page, so the view carries it instead. */
    var style = doc.body.getAttribute("style");
    if (style) v.setAttribute("style", style);

    v.__title = doc.title;
    return v;
  }

  /* --- the flight ----------------------------------------------------- */

  function place(el, r) {
    el.style.left   = r.left + "px";
    el.style.top    = r.top + "px";
    el.style.width  = r.width + "px";
    el.style.height = r.height + "px";
  }

  function box(r) {
    return { left: r.left + "px", top: r.top + "px",
             width: r.width + "px", height: r.height + "px" };
  }

  /* --- opening --------------------------------------------------------- */

  function open(url, card) {
    back = window.scrollY;

    return load(url).then(function (html) {
      var v = build(html);
      document.body.classList.add("case");     // the view needs its variables
      document.body.appendChild(v);

      var cover = v.querySelector(".shot__cover");
      if (!cover) throw new Error("nothing to fly to");

      // measured off the real thing, laid out at viewport size
      var toCover = cover.getBoundingClientRect();

      if (!soft || !card) { commit(v, url); return; }

      var img = card.querySelector("img");
      var fromCover = img.getBoundingClientRect();
      var radius = getComputedStyle(card).borderTopLeftRadius;

      var layer = document.createElement("div");
      layer.className = "handoff";

      var ghost = document.createElement("img");
      ghost.className = "handoff__cover";
      ghost.src = img.currentSrc || img.src;
      place(ghost, fromCover);
      ghost.style.borderRadius = radius;
      layer.appendChild(ghost);

      document.body.appendChild(layer);

      /* Hide the original card so nothing is doubled. It goes by class,
         because work.js writes `visibility: visible` inline on every card
         each frame and an inline style outranks a rule unless it insists. */
      card.classList.add("is-handoff");

      var opts = { duration: DUR, easing: EASE, fill: "forwards" };
      var run = ghost.animate(
        [ Object.assign(box(fromCover), { borderRadius: radius }),
          Object.assign(box(toCover), { borderRadius: "0px" }) ], opts);

      /* Everything that is not flying gets out of the way. The copy beside
         the card is part of that: it fades where it stands rather than
         being carried across the screen. */
      home.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: DUR * 0.46, easing: "cubic-bezier(0.33,0,0.67,1)", fill: "forwards" });

      var done = false;
      function land() {
        if (done) return;
        done = true;
        /* The ghosts are fixed to the viewport, so one left behind follows
           the visitor down the page forever. Their removal must not depend
           on anything above it succeeding — it is scheduled first, and the
           commit is allowed to fail on its own. */
        setTimeout(function () { layer.remove(); }, 90);
        try {
          commit(v, url);
        } catch (err) {
          layer.remove();
          busy = false;
        }
      }
      run.addEventListener("finish", land);
      setTimeout(land, DUR + 300);
    });
  }

  /* The swap itself: the view stops being a measuring stage and becomes
     the page. Its cover is already exactly where the ghost has arrived,
     so there is nothing to see. */
  function commit(v, url) {
    v.classList.remove("is-measuring");
    home.style.display = "none";
    scrollTo(0, 0);

    if (location.pathname !== new URL(url, location.href).pathname) {
      history.pushState({ hs: url }, "", url);
    }
    document.title = v.__title || document.title;

    view = v;
    if (window.CaseView) window.CaseView.init(v);
    busy = false;
  }

  /* --- closing --------------------------------------------------------- */

  function close() {
    if (!view) return;
    view.remove();
    view = null;

    document.body.classList.remove("case");
    home.style.display = "";
    home.getAnimations().forEach(function (a) { a.cancel(); });
    home.style.opacity = "";

    Array.prototype.forEach.call(document.querySelectorAll(".handoff"),
      function (el) { el.remove(); });          // never leave a ghost behind
    Array.prototype.forEach.call(document.querySelectorAll(".is-handoff"),
      function (el) { el.classList.remove("is-handoff"); });

    document.title = title;
    if (window.CaseView) window.CaseView.init(null);   // drop its listeners
    scrollTo(0, back);
    busy = false;
  }

  /* --- routing ---------------------------------------------------------- */

  function plain(e) {
    return e.defaultPrevented || e.button !== 0 ||
           e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  }

  deck.addEventListener("pointerover", function (e) {
    var card = e.target.closest && e.target.closest(".card");
    if (card && card.href) load(card.href);        // warm it while hovering
  });

  deck.addEventListener("click", function (e) {
    if (plain(e) || busy) return;
    var card = e.target.closest && e.target.closest(".card");
    if (!card || !card.href) return;

    e.preventDefault();
    busy = true;

    // a card caught mid-resolve is showing blocks, not the photograph
    var st = card.__px;
    if (st && st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    card.classList.add("is-sharp");

    open(card.href, card).catch(function () {
      busy = false;
      location.href = card.href;                   // anything unexpected: just go
    });
  });

  /* Inside an opened case, links back to the landing page close it rather
     than reloading, and next-project links open in place too. */
  document.addEventListener("click", function (e) {
    if (plain(e) || !view || busy) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || !view.contains(a)) return;

    var to = new URL(a.href, location.href);
    if (to.origin !== location.origin) return;

    var file = to.pathname.split("/").pop();
    if (!file || file === "index.html") {
      e.preventDefault();
      history.pushState({}, "", to.pathname + to.hash);
      close();
      return;
    }

    if (/\.html$/.test(file)) {                    // another project
      e.preventDefault();
      busy = true;
      var old = view;
      view = null;
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" })
         .addEventListener("finish", function () {
           old.remove();
           open(a.href, null).catch(function () { location.href = a.href; });
         });
    }
  });

  addEventListener("popstate", function () {
    if (view) close();
  });
})();

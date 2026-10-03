/* ===================================================================
   Horizon Symmetry, client space: the gate

   Runs on /portal/space before anything is drawn. Not logged in: off to
   the login, with the way back. Logged in: find the spaces this person
   may open, pick theirs, hand the record to portal.js and start it.

   A client with one project goes straight in. The team, or anyone with
   more than one, gets the list. Someone whose email is not connected to
   a project yet is told so, instead of seeing an empty page.

   What a person may open is decided by the database (portal-setup/
   supabase.sql), which only ever returns their own rows. The ?c= in the
   URL is a choice between those, never a key to anyone else's.
   =================================================================== */

(function () {
  "use strict";

  var A = window.HSAuth;
  var gate = document.getElementById("gate");
  var STUDIO = "horizonsymmetrystudio@gmail.com";
  var MAIL = '<a href="mailto:' + STUDIO + '">' + STUDIO + "</a>";
  var PORTAL_JS = "../js/portal.js?v=202609291505";

  if (!A || A.mode === "off") { location.replace("login"); return; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var here = location.pathname + location.search + location.hash;
  var want = new URLSearchParams(location.search).get("c");
  var viewer = null;

  function screen(o) {
    gate.innerHTML = '<div class="gate__box">' +
      (o.hosy ? '<img class="gate__hosy" src="../assets/hosy/' + o.hosy + '.png" alt="" width="501" height="501">' : "") +
      '<h1 class="gate__title" tabindex="-1">' + o.title + "</h1>" +
      (o.text ? '<p class="gate__text">' + o.text + "</p>" : "") + (o.body || "") +
      '<p class="gate__who">' + (viewer ? "Logged in as " + esc(viewer.email) + " · " : "") +
      '<button type="button" data-signout>Log out</button></p></div>';
    gate.querySelector(".gate__title").focus({ preventScroll: true });
  }

  gate.addEventListener("click", function (e) {
    if (e.target.closest("[data-signout]")) A.signOut().then(function () { location.replace("login"); });
  });

  function trouble() {
    screen({
      hosy: "thinking",
      title: "We couldn't open your space",
      text: "Something went wrong on our side. Refresh the page in a minute, or write to us at " + MAIL + "."
    });
  }

  function empty() {
    screen({
      hosy: "zen",
      title: "Your account is ready",
      text: "Your project will show up here once we've connected it to your email. " +
        "If you signed up with a different email from the one we've been writing to, tell us at " + MAIL + " and we'll connect it."
    });
  }

  function picker(list, team) {
    screen({
      title: team ? "All clients" : "Your projects",
      body: '<ul class="gate__list">' + list.map(function (c) {
        /* the team opens a space with the stage switcher on (portal.js
           also checks it is the team before showing it) */
        return '<li><a href="space?c=' + encodeURIComponent(c.id) + (team ? '&preview' : '') + '"><span>' + esc(c.name) + '</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10h13M11 4.5 16.5 10 11 15.5"/></svg></a></li>';
      }).join("") + "</ul>"
    });
  }

  function open(id) {
    return A.space(id).then(function (rec) {
      if (!rec) return trouble();
      window.HS_CLIENT = rec;
      window.HS_VIEWER = { email: viewer.email, name: viewer.name, team: viewer.team, readOnly: viewer.team };
      var u = new URL(location.href);
      u.searchParams.set("c", id);
      history.replaceState(null, "", u);
      var s = document.createElement("script");
      s.src = PORTAL_JS;
      s.onload = function () {
        gate.hidden = true;
        document.body.classList.remove("is-gated");
      };
      s.onerror = trouble;
      document.body.appendChild(s);
    });
  }

  A.user().then(function (u) {
    if (!u) { location.replace("login?next=" + encodeURIComponent(here)); return; }
    viewer = u;
    return Promise.all([A.isTeam(), A.spaces()]).then(function (r) {
      var team = r[0], list = r[1];
      viewer.team = team;
      var pick = want ? list.filter(function (c) { return c.id === want; })[0] : null;
      if (!pick && !team && list.length === 1) pick = list[0];
      if (pick) return open(pick.id);
      if (!list.length) return empty();
      picker(list, team);
    });
  }).catch(trouble);
})();

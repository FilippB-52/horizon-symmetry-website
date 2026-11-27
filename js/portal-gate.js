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
  var PORTAL_JS = "../js/portal.js?v=202611271800";

  if (!A || A.mode === "off") { location.replace("login"); return; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var here = location.pathname + location.search + location.hash;
  var want = new URLSearchParams(location.search).get("c");
  var viewer = null;

  function screen(o) {
    gate.innerHTML = '<div class="gate__box' + (o.wide ? " gate__box--wide" : "") + '">' +
      (o.hosy ? '<img class="gate__hosy" src="../assets/hosy/' + o.hosy + '.png" alt="" width="501" height="501">' : "") +
      '<h1 class="gate__title" tabindex="-1">' + o.title + "</h1>" +
      (o.text ? '<p class="gate__text">' + o.text + "</p>" : "") + (o.body || "") +
      '<p class="gate__who">' + (viewer ? "Logged in as " + esc(viewer.email) + " · " : "") +
      '<button type="button" data-signout>Log out</button></p></div>';
    gate.querySelector(".gate__title").focus({ preventScroll: true });
  }

  gate.addEventListener("click", function (e) {
    if (e.target.closest("[data-signout]")) { clearInterval(watching); A.signOut().then(function () { location.replace("login"); }); }
    if (e.target.closest("[data-recheck]")) recheck(true);
  });

  function trouble() {
    screen({
      hosy: "thinking",
      title: "We couldn't open your space",
      text: "Something went wrong on our side. Refresh the page in a minute, or write to us at " + MAIL + "."
    });
  }

  /* Signed up, but not connected to a project yet. We connect them from
     the client list, and this screen keeps checking (every 15 seconds,
     and the moment they come back to the tab), so their project opens
     here by itself. No refresh, no logging in again. */
  var watching = null;
  function empty(note) {
    screen({
      hosy: "zen",
      title: "Your account is ready",
      text: "We're connecting it to your project now. It opens right here by itself as soon as it's ready, so you can leave this page open. " +
        "Or close it and come back later: horizonsymmetry.com, then Client login.",
      body: '<p class="gate__alt"><button type="button" data-recheck>Check now</button></p>' +
        (note ? '<p class="gate__note" role="status">' + note + "</p>" : "") +
        '<p class="gate__small">Signed up with a different email from the one we\'ve been writing to? Tell us at ' + MAIL + " and we'll connect it.</p>"
    });
    if (!watching) {
      watching = setInterval(function () { recheck(false); }, 15000);
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") recheck(false); });
    }
  }
  var checking = false;
  function recheck(said) {
    if (checking || (!said && document.visibilityState === "hidden")) return;
    checking = true;
    A.spaces().then(function (list) {
      if (list.length) { clearInterval(watching); location.reload(); return; }
      if (said) empty("Not connected yet. It opens here as soon as it is.");
    }).catch(function () { if (said) empty("We couldn't check just now. Try again in a minute."); })
      .then(function () { checking = false; });
  }

  /* "2026-11-17" as "17 Nov", for the team's list */
  function sentDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? +m[3] + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1] : "";
  }

  /* ---------- the studio's side: who is waiting, and letting them in ----
     Someone who signs up before we have linked their email sees "Your
     account is ready" and waits. This is where the team sees them and
     connects each one to a space, or makes a new space for them. The
     database only does any of it for the team (supabase.sql). */

  var TEMPLATES_JS = "../js/portal-templates.js?v=202611172100";
  var waitingNow = [], spacesNow = [];

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function slug(name) {
    var base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "client";
    var id = base, n = 2;
    while (spacesNow.some(function (c) { return c.id === id; })) id = base + "-" + n++;
    return id;
  }
  function templates() {
    if (window.HS_TEMPLATES) return Promise.resolve(window.HS_TEMPLATES);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = TEMPLATES_JS;
      s.onload = function () { resolve(window.HS_TEMPLATES); };
      s.onerror = function () { reject(new Error("the templates did not load")); };
      document.head.appendChild(s);
    });
  }

  function waitingHtml(done) {
    var note = done ? '<p class="wait__done">' + esc(done) + "</p>" : "";
    if (!waitingNow.length) return note + '<p class="wait__none">Nobody is waiting to be connected. When someone signs up and has no project yet, they show up here.</p>';
    return note + '<h2 class="wait__title">Waiting to be connected</h2>' +
      '<p class="wait__lede">These people have made an account and see "Your account is ready". Connect each one to their space, or make a new space for them, and they are in.</p>' +
      '<ul class="wait__list">' + waitingNow.map(function (w, i) {
        var when = w.signed_up ? "signed up " + sentDay(String(w.signed_up).slice(0, 10)) : "";
        return '<li class="wait__row" data-i="' + i + '">' +
          '<div class="wait__who"><b>' + esc(w.name || w.email) + "</b><span>" + esc([w.name ? w.email : "", when].filter(Boolean).join(" · ")) + "</span>" +
          (w.confirmed ? "" : '<span class="wait__warn">Has not opened the confirmation email yet. <button type="button" data-confirm>Confirm it for them</button></span>') +
          '<button class="wait__remove" type="button" data-remove>Remove this sign-up</button></div>' +
          '<div class="wait__acts"><select class="field" data-space aria-label="Connect ' + esc(w.email) + ' to">' +
          '<option value="">Connect to…</option>' +
          spacesNow.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") +
          '<option value="+">A new space…</option></select>' +
          '<button class="cta" type="button" data-connect><span class="cta__label">Connect</span></button></div>' +
          '<form class="wait__new" hidden novalidate>' +
          '<label>Name of the client or brand<input class="field" name="title" autocomplete="off"></label>' +
          '<label>What we are making<select class="field" name="kind"><option value="web">A website</option><option value="brand">Branding</option></select></label>' +
          '<label>First day of the project<input class="field" name="start" type="date" value="' + today() + '"></label>' +
          '<label>Total price in euros, without VAT<input class="field" name="total" type="number" min="0" step="1" inputmode="numeric" placeholder="Empty if not agreed yet"></label>' +
          '<label class="wait__check"><input type="checkbox" name="paid"> The first half is already paid</label>' +
          "</form>" +
          '<p class="wait__msg" role="status"></p></li>';
      }).join("") + "</ul>";
  }

  function loadWaiting(done) {
    var box = document.getElementById("wait");
    if (!box) return;
    A.waiting().then(function (list) {
      waitingNow = list || [];
      box.innerHTML = waitingHtml(done);
    }).catch(function () {
      /* a database without the studio's functions yet: say so, never go quiet */
      box.innerHTML = '<p class="wait__none">The list of people waiting to be connected is not switched on yet. It needs the studio tools pasted into the database once (portal-setup/supabase.sql).</p>';
    });
  }

  /* after anything changes: fetch the spaces and the waiting list again */
  function refresh(done) {
    return A.spaces().then(function (list) { picker(list, true, done); });
  }

  gate.addEventListener("change", function (e) {
    var sel = e.target.closest("[data-space]");
    if (!sel) return;
    var row = sel.closest(".wait__row");
    row.querySelector(".wait__new").hidden = sel.value !== "+";
    row.querySelector(".wait__msg").textContent = "";
    row.querySelector("[data-connect] .cta__label").textContent = sel.value === "+" ? "Make the space" : "Connect";
    if (sel.value === "+") row.querySelector("[name=title]").focus();
  });

  gate.addEventListener("click", function (e) {
    var row = e.target.closest(".wait__row");
    if (!row) return;
    var w = waitingNow[+row.dataset.i], msg = row.querySelector(".wait__msg");
    var who = w.name || w.email;

    if (e.target.closest("[data-remove]")) {
      if (!window.confirm("Remove " + w.email + "?\n\nTheir account is deleted and they can no longer log in. Use this for tests and sign-ups you don't want. They can always sign up again.")) return;
      msg.textContent = "Removing…";
      A.removeAccount(w.email).then(function () { return refresh(w.email + " is removed."); })
        .catch(function (err) {
          msg.textContent = /schema cache|Could not find|PGRST202/i.test(String(err && (err.message || err.code)))
            ? "Removing is not switched on yet. It needs the studio tools pasted into the database once."
            : "That didn't work. Refresh the page and try again.";
        });
      return;
    }

    if (e.target.closest("[data-confirm]")) {
      if (!window.confirm("Only do this if " + who + " told you themselves that they signed up with " + w.email + " and the email never arrived.\n\nConfirm their email for them?")) return;
      A.confirmAccount(w.email).then(function () { return refresh(who + "'s email is confirmed."); })
        .catch(function () { msg.textContent = "That didn't work. Try again in a minute."; });
      return;
    }

    var btn = e.target.closest("[data-connect]");
    if (!btn || btn.disabled) return;
    var pick = row.querySelector("[data-space]").value;
    if (!pick) { msg.textContent = "Pick a space first, or choose A new space."; return; }
    var job, where;

    if (pick === "+") {
      var f = row.querySelector(".wait__new");
      var title = f.querySelector("[name=title]").value.trim(), start = f.querySelector("[name=start]").value;
      if (!title) { msg.textContent = "Give the space a name."; f.querySelector("[name=title]").focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { msg.textContent = "Pick the first day of the project."; return; }
      var id = slug(title);
      where = title;
      job = templates().then(function (T) {
        var rec = T.build({
          kind: f.querySelector("[name=kind]").value, id: id, name: title, contact: w.name,
          start: start, total: f.querySelector("[name=total]").value, paid: f.querySelector("[name=paid]").checked
        });
        return A.createSpace(id, title, rec, w.email);
      });
    } else {
      where = (spacesNow.filter(function (c) { return c.id === pick; })[0] || {}).name || pick;
      job = A.connect(pick, w.email);
    }

    btn.disabled = true;
    msg.textContent = "Working on it…";
    job.then(function () {
      return refresh(who + " is connected to " + where + (w.confirmed ? ". They can log in and see it now." : ". They still have to confirm their email before they can see it."));
    }).catch(function () {
      btn.disabled = false;
      msg.textContent = "That didn't work. Refresh the page and try again.";
    });
  });

  function picker(list, team, done) {
    spacesNow = list;
    screen({
      wide: team,
      title: team ? "All clients" : "Your projects",
      body: (team ? '<section class="wait" id="wait" aria-live="polite"></section>' + (list.length ? '<h2 class="wait__title wait__title--list">Clients</h2>' : "") : "") +
        '<ul class="gate__list">' + list.map(function (c) {
        /* the team opens a space with the stage switcher on (portal.js
           also checks it is the team before showing it) */
        return '<li data-id="' + esc(c.id) + '"><a href="space?c=' + encodeURIComponent(c.id) + (team ? '&preview' : '') + '"><span>' + esc(c.name) +
          (team && c.sent ? '<small>Questionnaire sent ' + esc(sentDay(c.sent)) + '</small>' : '') + '</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10h13M11 4.5 16.5 10 11 15.5"/></svg></a></li>';
      }).join("") + "</ul>"
    });
    if (team) { loadWaiting(done); loadActivity(); }
  }

  /* A client whose latest comment in Files is theirs is waiting on us:
     say so under their name, with the day they wrote. */
  function loadActivity() {
    if (!A.activity) return;
    A.activity().then(function (rows) {
      var latest = {};
      rows.forEach(function (r) { if (!latest[r.client_id]) latest[r.client_id] = r; });
      Object.keys(latest).forEach(function (id) {
        var r = latest[id];
        if (r.from_team) return;
        var li = document.querySelector('.gate__list li[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] a > span');
        if (!li) return;
        var note = document.createElement("small");
        note.className = "gate__waiting";
        note.textContent = "New comment, " + sentDay(r.created_at) + ": reply in Files";
        li.appendChild(note);
      });
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
      if (!list.length && !team) return empty();
      picker(list, team);
    });
  }).catch(trouble);
})();

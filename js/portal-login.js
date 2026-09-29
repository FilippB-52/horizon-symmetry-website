/* ===================================================================
   Horizon Symmetry, client space: the login pages

   One script for all five (login, signup, forgot, reset, confirm);
   <body data-page> says which one this is. Accounts are handled by
   window.HSAuth (portal-auth.js), so nothing here knows whether it is
   talking to Supabase or to the local test accounts.
   =================================================================== */

(function () {
  "use strict";

  var A = window.HSAuth;
  if (!A) return;

  var PAGE = document.body.dataset.page;
  var STUDIO = "horizonsymmetrystudio@gmail.com";
  var params = new URLSearchParams(location.search);
  var next = A.safeNext(params.get("next"));

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function go(url) { location.replace(url); }

  var card = $(".auth__card");
  var form = $(".auth__form");
  var MAIL = '<a href="mailto:' + STUDIO + '">' + STUDIO + "</a>";

  /* ---------- errors ------------------------------------------------ */

  function fieldErr(id, msg) {
    var inp = $("#" + id), out = $("#" + id + "-err");
    if (out) out.textContent = msg || "";
    if (inp) { if (msg) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
  }
  function clearErrs() {
    $$(".fld__err").forEach(function (e) { e.textContent = ""; });
    $$("[aria-invalid]").forEach(function (e) { e.removeAttribute("aria-invalid"); });
    var f = $("#form-err");
    if (f) f.textContent = "";
  }
  function showErr(e) {
    if (!e) return;
    if (e.field !== "form" && $("#" + e.field)) { fieldErr(e.field, e.message); $("#" + e.field).focus(); }
    else $("#form-err").textContent = e.message;
  }

  var BUSY = { login: "Logging in", signup: "Creating your account", forgot: "Sending", reset: "Saving" };
  function busy(on) {
    var b = $(".auth__go");
    if (!b) return;
    var l = $(".cta__label", b);
    if (on) { b.dataset.label = l.textContent; l.textContent = BUSY[PAGE] || l.textContent; }
    else if (b.dataset.label) l.textContent = b.dataset.label;
    b.disabled = on;
    b.setAttribute("aria-busy", on ? "true" : "false");
  }

  function val(id) { var e = $("#" + id); return e ? e.value.trim() : ""; }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  /* ---------- a finished step replaces the card ---------------------- */

  function state(o) {
    card.innerHTML = '<div class="auth__state">' +
      (o.hosy ? '<img class="auth__hosy" src="../assets/hosy/' + o.hosy + '.png" alt="" width="501" height="501">' : "") +
      '<h1 class="auth__title" id="auth-title" tabindex="-1">' + o.title + "</h1>" +
      '<p class="auth__lede">' + o.text + "</p>" + (o.actions || "") + "</div>";
    $("#auth-title").focus({ preventScroll: true });
  }
  function pill(href, label) {
    return '<a class="cta cta--solid auth__go" href="' + esc(href) + '"><span class="cta__label">' + label + "</span></a>";
  }
  function expired() {
    state({
      hosy: "thinking",
      title: "This link has expired",
      text: "Links from our emails work once, and only for a while. Ask for a new one, or log in if you already have a password.",
      actions: pill("forgot", "Get a new link") + '<p class="auth__alt"><a href="login">Log in</a></p>'
    });
  }

  /* ---------- show / hide password ---------------------------------- */

  $$("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var inp = b.parentNode.querySelector("input");
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.setAttribute("aria-pressed", show);
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  /* ---------- test mode note ---------------------------------------- */

  if (A.mode === "test" && A.testLogins) {
    var t = A.testLogins, note = $("#test-note");
    note.innerHTML = "<p><strong>Test mode.</strong> Not connected yet, so these are pretend accounts that live in this browser only. " +
      "Client: <code>" + t.client + "</code> · Team: <code>" + t.team + "</code> · Password: <code>" + t.password + "</code></p>" +
      (PAGE === "login" ? '<div class="auth__test-fill"><button type="button" data-fill="client">Fill in the client</button><button type="button" data-fill="team">Fill in the team</button></div>' : "");
    note.hidden = false;
    $$("[data-fill]", note).forEach(function (b) {
      b.addEventListener("click", function () {
        $("#email").value = t[b.dataset.fill];
        $("#password").value = t.password;
        clearErrs();
        $(".auth__go").focus();
      });
    });
  }

  /* ---------- the login isn't connected on this site ------------------ */

  if (A.mode === "off") {
    state({
      hosy: "zen",
      title: "Not open yet",
      text: "The client login isn't switched on yet. Write to us at " + MAIL + " and we'll send you everything by email."
    });
    return;
  }

  /* ---------- Google -------------------------------------------------- */

  if (A.google && $("#google")) {
    $("#google").hidden = false;
    $("[data-google]").addEventListener("click", function () {
      clearErrs();
      A.signInWithGoogle(next).then(function (r) { if (r && r.error) showErr(r.error); });
    });
  }

  /* ---------- per page ------------------------------------------------ */

  /* already signed in: the login and sign-up pages have nothing to offer */
  if (PAGE === "login" || PAGE === "signup") {
    A.user().then(function (u) { if (u) go(next); }).catch(function () {});
  }

  if (PAGE === "confirm") {
    A.confirm().then(function (r) {
      if (r.error) return expired();
      if (r.type === "recovery") return go("reset");
      if (r.type === "invite") return go("reset?type=invite");
      go(next);
    });
    return;
  }

  if (PAGE === "reset") {
    var invite = params.get("type") === "invite";
    if (invite) {
      $("#auth-title").textContent = "Choose a password";
      $(".auth__lede").textContent = "You'll use it with your email to log in from now on.";
      document.title = "Choose a password · Client space · Horizon Symmetry";
    }
    A.user().then(function (u) { if (!u) expired(); }).catch(expired);
  }

  if (!form) return;

  form.addEventListener("input", function (e) { if (e.target.id) fieldErr(e.target.id, ""); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    clearErrs();

    var email = val("email").toLowerCase();
    var pw = $("#password") ? $("#password").value : "";
    var bad = null;

    if (PAGE === "signup" && !val("name")) bad = bad || ["name", "Tell us your name."];
    if ($("#email") && !isEmail(email)) bad = bad || ["email", email ? "That doesn't look like an email address." : "Enter your email."];
    if (PAGE === "login" && !pw) bad = bad || ["password", "Enter your password."];
    if ((PAGE === "signup" || PAGE === "reset") && pw.length < 8) bad = bad || ["password", "Use at least 8 characters."];
    if (bad) { showErr({ field: bad[0], message: bad[1] }); return; }

    form.setAttribute("aria-busy", "true");
    busy(true);
    var done = function () { form.removeAttribute("aria-busy"); busy(false); };

    if (PAGE === "login") {
      A.signIn(email, pw).then(function (r) {
        if (r.error) { done(); showErr(r.error); return; }
        go(next);
      });
    }

    if (PAGE === "signup") {
      A.signUp(val("name"), email, pw).then(function (r) {
        if (r.error) { done(); showErr(r.error); return; }
        if (!r.confirm) return go(next);
        state({
          hosy: "excited",
          title: "Check your email",
          text: "We've sent a link to <b>" + esc(email) + "</b>. Open it to finish setting up your account.",
          actions: r.testLink ? pill(r.testLink, "Open the link (test mode)")
            : '<p class="auth__alt">Nothing after a few minutes? Check your spam, or write to us at ' + MAIL + ".</p>"
        });
      });
    }

    if (PAGE === "forgot") {
      A.forgot(email).then(function (r) {
        if (r.error) { done(); showErr(r.error); return; }
        /* the same answer whether or not the account exists, so this page
           can't be used to find out who our clients are */
        state({
          hosy: "pleased",
          title: "Check your email",
          text: "If there's an account for <b>" + esc(email) + "</b>, a link to choose a new password is on its way.",
          actions: r.testLink ? pill(r.testLink, "Open the link (test mode)") : '<p class="auth__alt"><a href="login">Back to log in</a></p>'
        });
      });
    }

    if (PAGE === "reset") {
      A.setPassword(pw).then(function (r) {
        if (r.error) { done(); showErr(r.error); return; }
        go(A.home);
      });
    }
  });
})();

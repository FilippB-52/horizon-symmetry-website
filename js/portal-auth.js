/* ===================================================================
   Horizon Symmetry, client space: accounts

   The only file that knows where accounts live. The login pages
   (portal-login.js) and the space itself (portal-gate.js, portal.js)
   call window.HSAuth and never talk to a backend directly.

   Three modes, decided once on load:
   - "live": portal/config.js has a Supabase URL and key.
   - "test": not connected, and the page is on localhost. Pretend
     accounts and client records, kept in this browser only, so the
     whole flow can be clicked through before the database exists.
   - "off":  not connected, on the real site. Nobody gets in.

   Access is enforced by the database, not by this file: a client's
   browser can only ever read the rows the rules in
   portal-setup/supabase.sql hand it. Everything here is routing.
   =================================================================== */

(function () {
  "use strict";

  var CFG = window.HS_PORTAL || {};
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var MODE = CFG.supabaseUrl && CFG.supabaseKey ? "live" : LOCAL ? "test" : "off";

  var HOME = "/portal/space";

  /* Where to go after logging in. Only our own portal pages, so a link
     like login?next=//evil.com (or /\evil.com, which browsers read the
     same way) can never send a client off the site. */
  function safeNext(raw) {
    if (typeof raw !== "string") return HOME;
    if (!/^\/portal\/[A-Za-z0-9\-\/]*(\?[A-Za-z0-9=&%\-_.]*)?(#[A-Za-z0-9\-]*)?$/.test(raw)) return HOME;
    if (raw.indexOf("//") > -1) return HOME;
    if (/^\/portal\/(login|signup|forgot|reset|confirm)\b/.test(raw)) return HOME;
    return raw;
  }

  function fail(field, message) { return { error: { field: field, message: message } }; }
  var GENERIC = "Something went wrong on our side. Try again in a minute.";

  /* ================================================================
     live: Supabase
     ================================================================ */

  /* Pinned, and checked against its hash, so a change on the CDN can
     never run on a page that holds a client's session. */
  var LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  var LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

  function live() {
    var sb = null, libP = null;
    function lib() {
      if (window.supabase && window.supabase.createClient) return Promise.resolve();
      if (!libP) {
        libP = new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = LIB;
          s.integrity = LIB_SRI;
          s.crossOrigin = "anonymous";
          s.onload = resolve;
          s.onerror = function () { libP = null; reject(new Error("supabase-js did not load")); };
          document.head.appendChild(s);
        });
      }
      return libP;
    }
    function client() {
      if (sb) return Promise.resolve(sb);
      return lib().then(function () {
        /* implicit flow: a link from the email works on any device, not
           only in the browser that asked for it */
        sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
          auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
        });
        return sb;
      });
    }

    function asUser(u) {
      if (!u) return null;
      var meta = u.user_metadata || {};
      return { email: (u.email || "").toLowerCase(), name: meta.full_name || meta.name || "" };
    }

    /* Client files live in a private bucket, so a record's "files/crude/x"
       is not an address anyone can open. Swap each one for a link that
       works for 12 hours. Supabase only signs files the database rules
       let this person read. A download keeps its proper name, which the
       download attribute can't do across sites. A file that isn't in
       the bucket yet comes back empty: never the public path, and a
       download with no link shows as "Uploading shortly". */
    var BUCKET = "client-files", TTL = 12 * 60 * 60;
    function signFiles(c, rec, id) {
      var prefix = "files/" + id + "/", found = [];
      (function walk(o) {
        Object.keys(o).forEach(function (k) {
          var v = o[k];
          if (o === rec && k === "state") return; /* their answers, not our files */
          if (typeof v === "string") {
            if (v.indexOf(prefix) === 0) found.push({ o: o, k: k, path: v.slice(6), name: k === "href" && typeof o.download === "string" && o.download ? o.download : null });
          } else if (v && typeof v === "object") walk(v);
        });
      })(rec);
      if (!found.length) return Promise.resolve(rec);

      var files = c.storage.from(BUCKET), urls = {};
      var plain = found.filter(function (f) { return !f.name; });
      var named = found.filter(function (f) { return f.name; });
      var paths = plain.map(function (f) { return f.path; }).filter(function (p, i, a) { return a.indexOf(p) === i; });

      return Promise.all([
        paths.length && files.createSignedUrls(paths, TTL).then(function (r) {
          (r.data || []).forEach(function (d) { if (!d.error && d.signedUrl) urls[d.path] = d.signedUrl; });
        })
      ].concat(named.map(function (f) {
        return files.createSignedUrl(f.path, TTL, { download: f.name }).then(function (r) {
          f.url = r.data && r.data.signedUrl;
        });
      }))).catch(function () { /* the space still opens, without its files */ })
        .then(function () {
          found.forEach(function (f) { f.o[f.k] = (f.name ? f.url : urls[f.path]) || ""; });
          return rec;
        });
    }

    function mapError(e, where) {
      var code = (e && (e.code || e.error_code)) || "";
      var msg = (e && e.message) || "";
      if (code === "invalid_credentials" || /invalid login/i.test(msg)) return fail("password", "That email and password don't match.");
      if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return fail("email", "Confirm your email first. The link is in your inbox.");
      if (code === "user_already_exists" || /already registered/i.test(msg)) return fail("email", "There's already an account with this email. Log in instead.");
      if (code === "weak_password" || /password/i.test(msg) && where !== "signin") return fail("password", "Pick a longer password, at least 8 characters.");
      if (code === "same_password") return fail("password", "That's your current password. Pick a new one.");
      if (/rate|too many/i.test(code + msg)) return fail("form", "Too many tries. Wait a minute and try again.");
      return fail("form", GENERIC);
    }

    return {
      user: function () {
        return client().then(function (c) { return c.auth.getSession(); })
          .then(function (r) { return asUser(r.data.session && r.data.session.user); });
      },
      signIn: function (email, pw) {
        return client().then(function (c) { return c.auth.signInWithPassword({ email: email, password: pw }); })
          .then(function (r) { return r.error ? mapError(r.error, "signin") : {}; }, function () { return fail("form", GENERIC); });
      },
      signUp: function (name, email, pw) {
        return client().then(function (c) {
          return c.auth.signUp({ email: email, password: pw, options: { data: { full_name: name }, emailRedirectTo: location.origin + HOME } });
        }).then(function (r) {
          if (r.error) return mapError(r.error, "signup");
          return { confirm: !r.data.session };
        }, function () { return fail("form", GENERIC); });
      },
      google: function (next) {
        return client().then(function (c) {
          return c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + safeNext(next) } });
        }).then(function (r) { return r.error ? fail("form", GENERIC) : {}; }, function () { return fail("form", GENERIC); });
      },
      forgot: function (email) {
        return client().then(function (c) {
          return c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/portal/reset" });
        }).then(function (r) { return r.error ? mapError(r.error, "forgot") : {}; }, function () { return fail("form", GENERIC); });
      },
      /* The page an email link lands on. Two shapes of link arrive here:
         ours (?token_hash=...&type=...) and Supabase's default one, which
         carries the session in the #hash and is picked up by the client
         on its own. */
      confirm: function () {
        var p = new URLSearchParams(location.search);
        var h = new URLSearchParams(location.hash.slice(1));
        if (h.get("error_code") || p.get("error_code")) return Promise.resolve({ error: "expired" });
        var hash = p.get("token_hash"), type = p.get("type") || "email";
        return client().then(function (c) {
          if (hash) {
            return c.auth.verifyOtp({ token_hash: hash, type: type }).then(function (r) {
              return r.error ? { error: "expired" } : { type: type };
            });
          }
          return c.auth.getSession().then(function (r) {
            return r.data.session ? { type: h.get("type") || type } : { error: "expired" };
          });
        }).catch(function () { return { error: "expired" }; });
      },
      setPassword: function (pw) {
        return client().then(function (c) { return c.auth.updateUser({ password: pw }); })
          .then(function (r) { return r.error ? mapError(r.error, "reset") : {}; }, function () { return fail("form", GENERIC); });
      },
      signOut: function () {
        return client().then(function (c) { return c.auth.signOut(); }).catch(function () {});
      },
      isTeam: function () {
        return client().then(function (c) { return c.rpc("is_team"); })
          .then(function (r) { return !r.error && r.data === true; }, function () { return false; });
      },
      spaces: function () {
        return client().then(function (c) { return c.from("clients").select("id, name").order("name"); })
          .then(function (r) { if (r.error) throw r.error; return r.data || []; });
      },
      space: function (id) {
        return client().then(function (c) {
          return c.from("clients").select("id, name, record, state").eq("id", id).maybeSingle().then(function (r) {
            if (r.error) throw r.error;
            if (!r.data) return null;
            var rec = r.data.record || {};
            rec.id = r.data.id;
            rec.name = rec.name || r.data.name;
            rec.state = r.data.state || {};
            return signFiles(c, rec, rec.id);
          });
        });
      },
      /* the client's own answers and picks. Only the client writes these;
         the database refuses the same write from anyone else. */
      writeState: function (id, state) {
        return client().then(function (c) { return c.from("clients").update({ state: state }).eq("id", id); });
      }
    };
  }

  /* ================================================================
     test: pretend accounts, this browser only
     ================================================================ */

  function test() {
    var ACC = "hs:test:accounts", SES = "hs:test:session";
    var PW = "test1234";

    /* Which pretend account may open which example client. Mirrors the
       `emails` column and the team_members table in the real database. */
    var CLIENTS = [{ id: "crude", emails: ["client@test.hs"] }];
    var TEAM = ["team@test.hs"];

    function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
    function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

    function accounts() {
      var a = read(ACC, {});
      if (!a["client@test.hs"]) a["client@test.hs"] = { name: "Test client", pw: PW, ok: true };
      if (!a["team@test.hs"]) a["team@test.hs"] = { name: "Filipp", pw: PW, ok: true };
      return a;
    }
    function me() {
      var e = read(SES, null), a = accounts()[e];
      return e && a ? { email: e, name: a.name } : null;
    }
    /* the network is never this fast, and a form that answers instantly
       hides the pending state that the real one will show */
    function later(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 450); }); }

    function loadRecord(id) {
      return new Promise(function (resolve) {
        var prev = window.HS_CLIENT;
        var s = document.createElement("script");
        s.src = "/portal/data/" + id + ".js?v=" + Date.now();
        s.onload = function () { var r = window.HS_CLIENT; window.HS_CLIENT = prev; resolve(r || null); };
        s.onerror = function () { window.HS_CLIENT = prev; resolve(null); };
        document.head.appendChild(s);
      });
    }
    function mine() {
      var u = me();
      if (!u) return [];
      var team = TEAM.indexOf(u.email) > -1;
      return CLIENTS.filter(function (c) { return team || c.emails.indexOf(u.email) > -1; });
    }

    return {
      testLogins: { client: "client@test.hs", team: "team@test.hs", password: PW },
      user: function () { return Promise.resolve(me()); },
      signIn: function (email, pw) {
        var a = accounts()[email];
        if (!a || a.pw !== pw) return later(fail("password", "That email and password don't match."));
        if (!a.ok) return later(fail("email", "Confirm your email first. The link is in your inbox."));
        write(SES, email);
        return later({});
      },
      signUp: function (name, email, pw) {
        var all = accounts();
        if (all[email] && all[email].ok) return later(fail("email", "There's already an account with this email. Log in instead."));
        all[email] = { name: name, pw: pw, ok: false };
        write(ACC, all);
        return later({ confirm: true, testLink: "confirm?type=email&test=" + encodeURIComponent(email) });
      },
      google: function () { return later(fail("form", "Google sign-in switches on once the login is connected.")); },
      forgot: function (email) {
        return later(accounts()[email] ? { testLink: "confirm?type=recovery&test=" + encodeURIComponent(email) } : {});
      },
      confirm: function () {
        var p = new URLSearchParams(location.search);
        var email = p.get("test"), all = accounts();
        if (!email || !all[email]) return later({ error: "expired" });
        all[email].ok = true;
        write(ACC, all);
        write(SES, email);
        return later({ type: p.get("type") || "email" });
      },
      setPassword: function (pw) {
        var u = me();
        if (!u) return later(fail("form", "This link has expired. Ask for a new one."));
        var all = accounts();
        all[u.email].pw = pw;
        write(ACC, all);
        return later({});
      },
      signOut: function () { try { localStorage.removeItem(SES); } catch (e) {} return Promise.resolve(); },
      isTeam: function () { var u = me(); return Promise.resolve(!!u && TEAM.indexOf(u.email) > -1); },
      spaces: function () {
        return Promise.all(mine().map(function (c) {
          return loadRecord(c.id).then(function (r) { return r && { id: c.id, name: r.name }; });
        })).then(function (l) { return l.filter(Boolean); });
      },
      space: function (id) {
        if (!mine().some(function (c) { return c.id === id; })) return Promise.resolve(null);
        return loadRecord(id);
      },
      /* test mode keeps answers where portal.js already keeps them */
      writeState: function () { return Promise.resolve(); }
    };
  }

  /* ================================================================
     off: the real site before the database is connected
     ================================================================ */

  function off() {
    function no() { return Promise.resolve(fail("form", "The client login isn't open yet.")); }
    return {
      user: function () { return Promise.resolve(null); },
      signIn: no, signUp: no, google: no, forgot: no, setPassword: no,
      confirm: function () { return Promise.resolve({ error: "expired" }); },
      signOut: function () { return Promise.resolve(); },
      isTeam: function () { return Promise.resolve(false); },
      spaces: function () { return Promise.resolve([]); },
      space: function () { return Promise.resolve(null); },
      writeState: function () { return Promise.resolve(); }
    };
  }

  var impl = MODE === "live" ? live() : MODE === "test" ? test() : off();

  /* Saves are coalesced: the questionnaire saves on every keystroke, and
     the database only needs the last one. Anything still waiting goes
     out when the tab is hidden or closed. */
  var pending = null, timer = null;
  function flush() {
    clearTimeout(timer);
    if (!pending) return;
    var p = pending;
    pending = null;
    impl.writeState(p.id, p.state).catch(function () { /* kept locally, retried on the next save */ });
  }
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });

  window.HSAuth = {
    mode: MODE,
    google: MODE === "live" && !!CFG.google,
    testLogins: impl.testLogins || null,
    safeNext: safeNext,
    home: HOME,
    user: impl.user,
    signIn: impl.signIn,
    signUp: impl.signUp,
    signInWithGoogle: impl.google,
    forgot: impl.forgot,
    confirm: impl.confirm,
    setPassword: impl.setPassword,
    signOut: function () { flush(); return impl.signOut(); },
    isTeam: impl.isTeam,
    spaces: impl.spaces,
    space: impl.space,
    saveState: function (id, state) {
      pending = { id: id, state: JSON.parse(JSON.stringify(state)) };
      clearTimeout(timer);
      timer = setTimeout(flush, 800);
    }
  };
})();

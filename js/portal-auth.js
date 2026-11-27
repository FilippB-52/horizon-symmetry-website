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

  /* shared items and comments: the columns the space reads */
  var ITEM_COLS = "id, client_id, section, kind, title, note, url, path, file_name, size, added_by, created_at";
  var COMMENT_COLS = "id, item_id, client_id, author, author_name, from_team, body, created_at";
  function missingTable(e) {
    var code = (e && e.code) || "", msg = (e && e.message) || "";
    return code === "PGRST205" || code === "42P01" || /schema cache|does not exist/i.test(msg);
  }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  /* a storage key that survives any file name; the real name is kept
     in the row and given back on download */
  function safeName(n) {
    var s = String(n || "file").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
    return (s || "file").slice(-120);
  }

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
        return client().then(function (c) { return c.from("clients").select("id, name, sent:state->>qSentOn").order("name"); })
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
      },
      /* The studio's side: who has signed up and is connected to nothing,
         and letting them in. The database refuses all four to anyone who
         is not the team. */
      waiting: function () {
        return client().then(function (c) { return c.rpc("waiting_accounts"); })
          .then(function (r) { if (r.error) throw r.error; return r.data || []; });
      },
      connect: function (space, email) {
        return client().then(function (c) { return c.rpc("connect_account", { space: space, who: email }); })
          .then(function (r) { if (r.error) throw r.error; });
      },
      createSpace: function (id, name, record, email) {
        return client().then(function (c) { return c.rpc("create_space", { space: id, title: name, rec: record, who: email || null }); })
          .then(function (r) { if (r.error) throw r.error; });
      },
      confirmAccount: function (email) {
        return client().then(function (c) { return c.rpc("confirm_account", { who: email }); })
          .then(function (r) { if (r.error) throw r.error; });
      },
      removeAccount: function (email) {
        return client().then(function (c) { return c.rpc("remove_account", { who: email }); })
          .then(function (r) { if (r.error) throw r.error; });
      },

      /* What the team shared in a client's Files view, and the comments
         on it. Files come back with a 12-hour link that downloads under
         the file's own name. Before supabase.sql has been run with these
         tables in it, this answers { missing: true } instead of failing,
         so the space still opens and the team is told what to do. */
      shared: function (id) {
        return client().then(function (c) {
          return Promise.all([
            c.from("client_items").select(ITEM_COLS).eq("client_id", id).order("created_at"),
            c.from("client_comments").select(COMMENT_COLS).eq("client_id", id).order("created_at")
          ]).then(function (r) {
            var e = r[0].error || r[1].error;
            if (e) { if (missingTable(e)) return { missing: true, items: [], comments: [] }; throw e; }
            var items = r[0].data || [];
            return Promise.all(items.map(function (x) {
              if (x.kind !== "file") { x.href = x.url; return null; }
              return c.storage.from(BUCKET).createSignedUrl(x.path, TTL, { download: x.file_name || true })
                .then(function (s) { x.href = (s.data && s.data.signedUrl) || ""; }, function () { x.href = ""; });
            })).then(function () { return { items: items, comments: r[1].data || [] }; });
          });
        });
      },
      /* team only: the database refuses it to anyone else, and refuses an
         upload into a folder that is not an existing client's */
      share: function (id, it) {
        return client().then(function (c) {
          var row = { client_id: id, section: it.section, kind: it.kind, title: it.title, note: it.note || "" };
          var up = Promise.resolve();
          if (it.kind === "file") {
            row.path = id + "/shared/" + randomId() + "/" + safeName(it.file.name);
            row.file_name = it.file.name;
            row.size = it.file.size;
            up = c.storage.from(BUCKET).upload(row.path, it.file, { contentType: it.file.type || "application/octet-stream", upsert: false })
              .then(function (r) { if (r.error) throw r.error; });
          } else row.url = it.url;
          return up.then(function () { return c.from("client_items").insert(row).select(ITEM_COLS).single(); })
            .then(function (r) {
              if (r.error) {
                if (row.path) c.storage.from(BUCKET).remove([row.path]);
                throw r.error;
              }
              var x = r.data;
              if (x.kind !== "file") { x.href = x.url; return x; }
              return c.storage.from(BUCKET).createSignedUrl(x.path, TTL, { download: x.file_name || true })
                .then(function (s) { x.href = (s.data && s.data.signedUrl) || ""; return x; });
            });
        });
      },
      unshare: function (item) {
        return client().then(function (c) {
          return c.from("client_items").delete().eq("id", item.id).select("id").then(function (r) {
            if (r.error) throw r.error;
            if (!r.data || !r.data.length) throw new Error("not removed");
            if (item.path) return c.storage.from(BUCKET).remove([item.path]).then(function () {});
          });
        });
      },
      /* who wrote it, and whether it was the team, the database decides */
      comment: function (item, body) {
        return client().then(function (c) {
          return c.from("client_comments").insert({ item_id: item.id, client_id: item.client_id, body: body }).select(COMMENT_COLS).single();
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      uncomment: function (cm) {
        return client().then(function (c) {
          return c.from("client_comments").delete().eq("id", cm.id).select("id");
        }).then(function (r) { if (r.error) throw r.error; if (!r.data || !r.data.length) throw new Error("not removed"); });
      },
      /* the team's client list: the latest comments across every space */
      activity: function () {
        return client().then(function (c) {
          return c.from("client_comments").select("client_id, from_team, created_at").order("created_at", { ascending: false }).limit(500);
        }).then(function (r) { return r.error ? [] : r.data || []; }, function () { return []; });
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
    var CLIENTS = [
      { id: "crude", emails: ["client@test.hs"] },       /* a branding project */
      { id: "demo", emails: ["web@test.hs"] }            /* a website build */
    ];
    var TEAM = ["team@test.hs"];

    function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
    function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

    function accounts() {
      var a = read(ACC, {});
      if (!a["client@test.hs"]) a["client@test.hs"] = { name: "Test client", pw: PW, ok: true };
      if (!a["team@test.hs"]) a["team@test.hs"] = { name: "Filipp", pw: PW, ok: true };
      if (!a["web@test.hs"]) a["web@test.hs"] = { name: "Test web client", pw: PW, ok: true };
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
    /* spaces made, and people connected, from the team's list */
    var MADE = "hs:test:made", LINKS = "hs:test:links", SHARED = "hs:test:shared";
    function all() {
      var made = read(MADE, {}), links = read(LINKS, {});
      return CLIENTS.concat(Object.keys(made).map(function (id) { return { id: id, emails: [], made: made[id] }; }))
        .map(function (c) { return { id: c.id, made: c.made, emails: c.emails.concat(links[c.id] || []) }; });
    }
    function mine() {
      var u = me();
      if (!u) return [];
      var team = TEAM.indexOf(u.email) > -1;
      return all().filter(function (c) { return team || c.emails.indexOf(u.email) > -1; });
    }
    function record(c) { return c.made ? Promise.resolve(JSON.parse(JSON.stringify(c.made))) : loadRecord(c.id); }
    function teamOnly() { var u = me(); return !!u && TEAM.indexOf(u.email) > -1; }

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
          return record(c).then(function (r) { return r && { id: c.id, name: r.name }; });
        })).then(function (l) { return l.filter(Boolean); });
      },
      space: function (id) {
        var c = mine().filter(function (x) { return x.id === id; })[0];
        return c ? record(c) : Promise.resolve(null);
      },
      /* test mode keeps answers where portal.js already keeps them */
      writeState: function () { return Promise.resolve(); },
      waiting: function () {
        if (!teamOnly()) return later([]);
        var a = accounts(), linked = [].concat.apply([], all().map(function (c) { return c.emails; }));
        return later(Object.keys(a).filter(function (e) { return TEAM.indexOf(e) < 0 && linked.indexOf(e) < 0; })
          .map(function (e) { return { email: e, name: a[e].name, signed_up: null, confirmed: !!a[e].ok }; }));
      },
      connect: function (space, email) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        var links = read(LINKS, {});
        links[space] = (links[space] || []).concat(email);
        write(LINKS, links);
        return later();
      },
      createSpace: function (id, name, rec, email) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        var made = read(MADE, {});
        made[id] = rec;
        write(MADE, made);
        if (email) { var links = read(LINKS, {}); links[id] = [email]; write(LINKS, links); }
        return later();
      },
      confirmAccount: function (email) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        var a = accounts();
        if (a[email]) { a[email].ok = true; write(ACC, a); }
        return later();
      },
      removeAccount: function (email) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        var linked = [].concat.apply([], all().map(function (c) { return c.emails; }));
        if (TEAM.indexOf(email) > -1 || linked.indexOf(email) > -1) return Promise.reject(new Error("only someone waiting to be connected can be removed"));
        var a = accounts();
        delete a[email];
        write(ACC, a);
        return later();
      },

      /* shared items and comments, this browser only. A file is kept as a
         data address, so only small ones fit (the real bucket takes 50 MB). */
      shared: function (id) {
        if (!mine().some(function (c) { return c.id === id; })) return later({ items: [], comments: [] });
        var d = read(SHARED, { items: [], comments: [] });
        return later({
          items: d.items.filter(function (x) { return x.client_id === id; }).map(function (x) { return Object.assign({}, x, { href: x.kind === "file" ? x.data : x.url }); }),
          comments: d.comments.filter(function (x) { return x.client_id === id; })
        });
      },
      share: function (id, it) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        if (it.kind === "link" && !/^https?:\/\/\S+$/i.test(it.url || "")) return Promise.reject(new Error("check constraint"));
        var row = { id: randomId(), client_id: id, section: it.section, kind: it.kind, title: it.title, note: it.note || "",
          url: it.kind === "link" ? it.url : null, path: null, file_name: null, size: null, added_by: me().email, created_at: new Date().toISOString() };
        var go = Promise.resolve();
        if (it.kind === "file") {
          if (it.file.size > 3e6) return Promise.reject(new Error("test mode keeps files up to 3 MB"));
          row.path = id + "/shared/" + row.id + "/" + safeName(it.file.name);
          row.file_name = it.file.name;
          row.size = it.file.size;
          go = new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { row.data = fr.result; resolve(); };
            fr.onerror = reject;
            fr.readAsDataURL(it.file);
          });
        }
        return go.then(function () {
          var d = read(SHARED, { items: [], comments: [] });
          d.items.push(row);
          write(SHARED, d);
          return later(Object.assign({}, row, { href: row.kind === "file" ? row.data : row.url }));
        });
      },
      unshare: function (item) {
        if (!teamOnly()) return Promise.reject(new Error("the studio only"));
        var d = read(SHARED, { items: [], comments: [] });
        d.items = d.items.filter(function (x) { return x.id !== item.id; });
        d.comments = d.comments.filter(function (x) { return x.item_id !== item.id; });
        write(SHARED, d);
        return later();
      },
      comment: function (item, body) {
        var u = me(), d = read(SHARED, { items: [], comments: [] });
        var it = d.items.filter(function (x) { return x.id === item.id; })[0];
        if (!u || !it || !mine().some(function (c) { return c.id === it.client_id; })) return Promise.reject(new Error("row-level security"));
        var team = TEAM.indexOf(u.email) > -1;
        var row = { id: randomId(), item_id: it.id, client_id: it.client_id, author: u.email,
          author_name: team ? "Horizon Symmetry" : (u.name || u.email.split("@")[0]), from_team: team, body: body, created_at: new Date().toISOString() };
        d.comments.push(row);
        write(SHARED, d);
        return later(row);
      },
      uncomment: function (cm) {
        var u = me(), d = read(SHARED, { items: [], comments: [] });
        if (!u || (cm.author !== u.email && TEAM.indexOf(u.email) < 0)) return Promise.reject(new Error("not removed"));
        d.comments = d.comments.filter(function (x) { return x.id !== cm.id; });
        write(SHARED, d);
        return later();
      },
      activity: function () {
        if (!teamOnly()) return later([]);
        return later(read(SHARED, { items: [], comments: [] }).comments.slice().reverse()
          .map(function (x) { return { client_id: x.client_id, from_team: x.from_team, created_at: x.created_at }; }));
      }
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
      writeState: function () { return Promise.resolve(); },
      waiting: function () { return Promise.resolve([]); },
      connect: no, createSpace: no, confirmAccount: no, removeAccount: no,
      shared: function () { return Promise.resolve({ items: [], comments: [] }); },
      share: no, unshare: no, comment: no, uncomment: no,
      activity: function () { return Promise.resolve([]); }
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
    waiting: impl.waiting,
    connect: impl.connect,
    createSpace: impl.createSpace,
    confirmAccount: impl.confirmAccount,
    removeAccount: impl.removeAccount,
    shared: impl.shared,
    share: impl.share,
    unshare: impl.unshare,
    comment: impl.comment,
    uncomment: impl.uncomment,
    activity: impl.activity,
    saveState: function (id, state) {
      pending = { id: id, state: JSON.parse(JSON.stringify(state)) };
      clearTimeout(timer);
      timer = setTimeout(flush, 800);
    }
  };
})();

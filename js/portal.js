/* ===================================================================
   Horizon Symmetry, client space

   Reads one client record (window.HS_CLIENT, from portal/data/<id>.js)
   and draws the whole page from it. Nothing is written by hand per
   client: status, progress, what is ready and what is owed all fall out
   of comparing the record's dates with today.

   It is an app, not a document. The sidebar is the navigation, and the
   main area shows one view at a time (#home, #timeline, #files ...), so
   a client is never scrolling past things that are not theirs yet. The
   view lives in the URL hash, so the back button and shared links work.

   It is started by portal-gate.js once someone is logged in, which
   hands it the record (window.HS_CLIENT) and who is looking
   (window.HS_VIEWER). The client's own actions (questionnaire answers,
   their pick of direction, a booked call) are saved to their record
   through HSAuth.saveState. The places still waiting for a real backend
   (messages, bookings) say so in a comment starting "BACKEND:".

   ?preview adds a stage switcher to the sidebar that moves "today"
   through the project's life. The studio's review tool, team only.
   =================================================================== */

(function () {
  "use strict";

  var C = window.HS_CLIENT;
  if (!C) return;

  /* The team opens a client's space to look, never to answer for them:
     nothing a team member clicks is saved to the client's record. */
  var VIEWER = window.HS_VIEWER || null;
  var WRITES = !!(VIEWER && !VIEWER.readOnly && window.HSAuth);

  var STUDIO = {
    email: "horizonsymmetrystudio@gmail.com",
    cal: "horizon-symmetry/30min"
  };
  var HOSY = "../assets/hosy/";
  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- icons ------------------------------------------------- */

  function svg(d, w) {
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="' + (w || 1.4) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  }
  var I = {
    right: svg('<path d="M3.5 10h13M11 4.5 16.5 10 11 15.5"/>'),
    out: svg('<path d="M6 14 14 6M7 6h7v7"/>', 1.5),
    down: svg('<path d="M10 3.5v10M5.5 9 10 13.5 14.5 9M4 16.5h12"/>', 1.5),
    check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.5 3.6"/></svg>',
    home: svg('<path d="M3.5 9 10 3.5 16.5 9v7.5h-4.5v-4.5h-4v4.5H3.5z"/>'),
    timeline: svg('<circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="15" r="1.5"/><path d="M5 6.5v7M9 5h7.5M9 15h5"/>'),
    questionnaire: svg('<path d="M5.5 3.5h9v13h-9z"/><path d="M8 7.5h4M8 10.5h4M8 13.5h2.5"/>'),
    directions: svg('<path d="M10 3.5 16.5 10 10 16.5 3.5 10z"/><circle cx="10" cy="10" r="1.6"/>'),
    files: svg('<path d="M3.5 5.5h4.5l1.5 2h7v8.5h-13z"/>'),
    payments: svg('<path d="M3 5.5h14v9H3z"/><path d="M3 8.5h14M6 12h3"/>'),
    calls: svg('<path d="M4 5.5h12v10.5H4z"/><path d="M4 8.5h12M7.5 3.5v3M12.5 3.5v3"/>'),
    messages: svg('<path d="M4 4.5h12v8.5H9l-3.5 3v-3H4z"/>'),
    menu: svg('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>', 1.5)
  };

  /* ---------- small helpers ----------------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Dates are local calendar days: "2026-05-07" is the 7th wherever the
     client is, never shifted by a timezone. */
  function date(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  function day(x) {
    var t = typeof x === "string" ? date(x) : x;
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  }
  var F_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  var F_SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  var F_WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
  var F_MON = new Intl.DateTimeFormat("en-GB", { month: "short" });
  function nice(iso) { return F_DAY.format(date(iso)); }
  function short(iso) { return F_SHORT.format(date(iso)); }
  function clock(iso) {
    var t = date(iso);
    return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  }
  function money(n) { return "€" + (n % 1 ? n.toFixed(2) : String(n)); }
  function iso(t) {
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function range(a, b) { return a === b ? short(a) : short(a) + " to " + short(b); }

  /* ---------- what this browser remembers --------------------------- */

  /* The record's saved state wins when it has any: it is what the client
     did on any device. This browser's copy is the fallback, and all there
     is in test mode. */
  var KEY = "hs:portal:" + C.id;
  function load() {
    if (C.state && typeof C.state === "object" && Object.keys(C.state).length) return C.state;
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { /* private mode: still works, just forgets */ }
    if (WRITES) window.HSAuth.saveState(C.id, local);
  }
  var local = load();
  local.answers = local.answers || {};

  /* ---------- today, and the studio preview ------------------------- */

  var params = new URLSearchParams(location.search);
  var PREVIEW = params.has("preview") && !!(VIEWER && VIEWER.team);
  var stageId = params.get("preview") || "";
  function stageToday() {
    var s = (C.preview || []).filter(function (x) { return x.id === stageId; })[0];
    return s ? date(s.date) : new Date();
  }
  var today = stageToday();

  /* ---------- the model: done, now, next ---------------------------- */

  function answered(q) {
    var v = local.answers[q.id];
    if (v == null) return false;
    if (Array.isArray(v)) return v.some(function (x) { return String(x).trim(); });
    return String(v).trim() !== "";
  }

  function model() {
    var t = day(today);
    var m = { t: t };

    m.steps = C.steps.map(function (s) {
      var status = day(s.end) <= t ? "done" : day(s.start) <= t ? "now" : "next";
      return Object.assign({}, s, { status: status });
    });
    m.delivered = m.steps[m.steps.length - 1].status === "done";

    m.qCount = C.questions.length;
    m.qAnswered = C.questions.filter(answered).length;
    m.qStarted = !!local.qStarted && m.qAnswered > 0;
    m.qSent = local.qSentOn || (day(C.questionnaire.on) <= t ? C.questionnaire.on : null);

    m.calls = C.calls.map(function (c) {
      var booked = day(c.bookedOn) <= t || (c.kickoff && local.kickoffBooked);
      return Object.assign({}, c, { booked: booked, past: day(c.on) < t, localOnly: booked && day(c.bookedOn) > t });
    }).filter(function (c) { return c.booked; });
    var kick = m.calls.filter(function (c) { return c.kickoff; })[0];
    m.kickoffBooked = !!kick;
    m.kickoffUpcoming = !!kick && !kick.past;
    m.kickoff = kick;
    m.nextCall = m.calls.filter(function (c) { return !c.past; })[0] || null;

    m.reviewOpen = day(C.review.opensOn) <= t;
    if (local.review && local.review.on) m.decision = local.review;
    else if (day(C.review.decidedOn) <= t) m.decision = Object.assign({ on: C.review.decidedOn }, C.review.decision);
    else m.decision = null;
    /* the direction step ends when the client decides, not on a date */
    if (m.decision) m.steps.forEach(function (s) { if (s.id === C.review.step) s.status = "done"; });
    m.current = m.steps.filter(function (s) { return s.status !== "done"; })[0] || null;

    m.deliverables = C.deliverables.map(function (x) {
      var step = m.steps.filter(function (s) { return s.id === x.step; })[0];
      var ready = day(x.readyOn) <= t;
      var fresh = ready && (today - date(x.readyOn)) / 864e5 < 3;
      var status = ready ? "ready" : step && step.status === "now" ? "progress" : "planned";
      return Object.assign({}, x, { status: status, fresh: fresh });
    });
    m.ready = m.deliverables.filter(function (x) { return x.status === "ready"; }).length;

    m.pay = C.payments.items.map(function (p) {
      var paid = !!p.paidOn && day(p.paidOn) <= t;
      var due = !paid && (!p.dueOn || day(p.dueOn) <= t);
      return Object.assign({}, p, { paid: paid, due: due });
    });
    m.paidInFull = m.pay.every(function (p) { return p.paid; });
    m.payDue = m.pay.filter(function (p) { return p.due; })[0] || null;

    m.state = !m.qSent ? "questionnaire"
      : !m.kickoffBooked ? "kickoff"
      : m.kickoffUpcoming ? "kickoff-booked"
      : m.reviewOpen && !m.decision ? "review"
      : m.delivered && m.payDue ? "pay"
      : m.delivered && m.paidInFull ? "complete"
      : "working";
    m.needsClient = ["questionnaire", "kickoff", "review", "pay"].indexOf(m.state) > -1;
    return m;
  }

  /* ---------- building blocks --------------------------------------- */

  /* a view change is a real link, so it works with the back button; an
     action is a button */
  function cta(label, to, solid) {
    var cls = "cta" + (solid ? " cta--solid" : "");
    var inner = '<span class="cta__label">' + esc(label) + '</span><span class="cta__arrow">' + I.right + "</span>";
    return to.charAt(0) === "#"
      ? '<a class="' + cls + '" href="' + to + '">' + inner + "</a>"
      : '<button class="' + cls + '" type="button" data-action="' + to + '">' + inner + "</button>";
  }
  function link(label, to) {
    return to.charAt(0) === "#"
      ? '<a class="p-link" href="' + to + '">' + esc(label) + I.right + "</a>"
      : '<button class="p-link" type="button" data-action="' + to + '">' + esc(label) + I.right + "</button>";
  }
  function viewHead(eyebrow, title, lede, aside) {
    return '<header class="v-head"><div><p class="p-eyebrow">' + esc(eyebrow) + '</p>' +
      '<h1 class="v-title" tabindex="-1">' + esc(title) + "</h1>" +
      (lede ? '<p class="p-lede">' + lede + "</p>" : "") + "</div>" +
      (aside ? '<div class="v-aside">' + aside + "</div>" : "") + "</header>";
  }
  function pickName(kind, id) {
    var x = C.directions[kind].filter(function (o) { return o.id === id; })[0];
    return x ? x.name : id;
  }

  /* ---------- the one thing that matters now ------------------------ */

  function nowCopy(m) {
    var lead = C.project.team[0] ? C.project.team[0].name : "We";
    switch (m.state) {
      case "questionnaire":
        return {
          hosy: "happy", eyebrow: "Your first step", action: true,
          title: "Tell us about " + C.name + ".",
          text: m.qStarted
            ? "You're " + m.qAnswered + " of " + m.qCount + " in, and it's all saved. Pick up where you left off."
            : m.qCount + " short questions, about " + C.questionnaire.minutes + " minutes. We've filled in what we already know, so most of it is checking our homework.",
          actions: cta(m.qStarted ? "Continue the questionnaire" : "Start the questionnaire", "q-open", true) +
            link("Book your kickoff call", "book")
        };
      case "kickoff":
        return {
          hosy: "excited", eyebrow: "Your next step", action: true,
          title: "Book your kickoff call.",
          text: "Thirty minutes to go through your answers and agree what matters most. Pick any slot that suits you.",
          actions: cta("Book the call", "book", true)
        };
      case "kickoff-booked":
        var k = m.kickoff;
        return {
          hosy: "pleased", eyebrow: "Nothing needed from you",
          title: k.localOnly ? "See you soon." : "See you on " + F_WEEKDAY.format(date(k.on)) + ".",
          text: (k.localOnly ? "Your kickoff call is booked and the invite is in your inbox. "
            : "Your kickoff call is on <strong>" + nice(k.on) + " at " + clock(k.on) + "</strong>. ") + esc(lead) + " reads your answers before then.",
          actions: ""
        };
      case "review":
        var call = m.nextCall && day(m.nextCall.on) === m.t ? m.nextCall : null;
        return {
          hosy: "curious", eyebrow: "Your call to make", action: true,
          title: "Three directions for your logo.",
          text: "Pick the one that feels most like " + esc(C.name) + ", and the face for your body text. Nothing gets built until you do." +
            (call ? " We'll also walk you through them on today's call at " + clock(call.on) + "." : ""),
          actions: cta("See the directions", "#directions", true)
        };
      case "pay":
        return {
          hosy: "excited", eyebrow: "Delivered", action: true,
          title: "Everything is ready.",
          text: "Every file is in Files, yours to keep. The last step is the final payment of <strong>" + money(m.payDue.amount) + "</strong>.",
          actions: cta("Pay the final 50%", "#payments", true) + link("Go to your files", "#files")
        };
      case "complete":
        return {
          hosy: "celebrating", eyebrow: "All done",
          title: C.name + " is out in the world.",
          text: "Your files stay in Files, yours to download any time. If you have a minute, one honest line about working with us helps more than you'd think.",
          actions: link("Go to your files", "#files")
        };
      default:
        var cur = m.current;
        var lands = cur && m.deliverables.filter(function (x) { return x.step === cur.id; })[0];
        var picked = local.review && local.review.on && m.decision && day(local.review.on) === m.t;
        return {
          hosy: "thinking", eyebrow: "Nothing needed from you",
          title: cur ? "We're " + cur.doing + "." : "We're on it.",
          text: (picked ? "Got your pick: " + esc(pickName("logo", m.decision.logo)) + ", with " + esc(pickName("type", m.decision.type)) + ". " : "") +
            (cur ? "Next update by <strong>" + nice(cur.end) + "</strong>" +
              (lands ? ", when your " + esc(lands.name.toLowerCase()) + " lands in Files." : ".") : ""),
          actions: m.ready ? link("See what's ready", "#files") : ""
        };
    }
  }

  /* where the client is in time, in the plainest terms: week 2 of 6 */
  function whereInTime(m) {
    var first = date(C.steps[0].start), last = date(C.steps[C.steps.length - 1].end);
    var weeks = Math.ceil(((last - first) / 864e5 + 1) / 7);
    if (m.delivered) return "Delivered " + short(C.steps[C.steps.length - 1].end);
    if (today < first) return "Starts " + nice(C.steps[0].start);
    var wk = Math.min(Math.floor((today - first) / (7 * 864e5)) + 1, weeks);
    return "Week " + wk + " of " + weeks + (m.current ? " · " + m.current.phase : "");
  }

  function phases(m) {
    return C.phases.map(function (name) {
      var ss = m.steps.filter(function (s) { return s.phase === name; });
      var status = ss.every(function (s) { return s.status === "done"; }) ? "done"
        : m.current && m.current.phase === name ? "now" : "next";
      return { name: name, status: status, steps: ss, start: ss[0].start, end: ss[ss.length - 1].end };
    });
  }

  function track(m) {
    var ph = phases(m);
    var idx = ph.map(function (p) { return p.status; }).indexOf("now");
    var fill = idx < 0 ? (m.current ? 0 : 1) : idx / (ph.length - 1);
    return '<ol class="track" style="--n:' + ph.length + ";--p:" + fill.toFixed(3) + '">' +
      ph.map(function (p) {
        return '<li class="is-' + p.status + '"><span class="track__node"></span><span class="track__name">' + esc(p.name) + "</span></li>";
      }).join("") + "</ol>";
  }

  /* ---------- views ------------------------------------------------- */

  var sets = {};
  var openFolds = null;
  var openPhases = null;

  var VIEWS = {
    home: {
      label: "Home", icon: "home",
      render: function (m) {
        var n = nowCopy(m);
        var p = C.project;
        var now = '<section class="now' + (n.action ? "" : " is-quiet") + '" aria-labelledby="now-title">' +
          '<div class="now__hosy"><img src="' + HOSY + n.hosy + '.png" alt="" width="500" height="500" decoding="async"></div>' +
          '<div class="now__body">' +
          '<p class="now__eyebrow"><span class="p-dot' + (n.action ? "" : " is-quiet") + '"></span>' + esc(n.eyebrow) + "</p>" +
          '<h2 class="now__title" id="now-title">' + esc(n.title) + "</h2>" +
          '<p class="now__text">' + n.text + "</p>" +
          (n.actions ? '<div class="now__actions">' + n.actions + "</div>" : "") +
          "</div></section>";
        var where = '<a class="where" href="#timeline"><div class="where__row"><p class="p-sub">Where we are</p>' +
          '<span class="where__go">Full timeline' + I.right + "</span></div>" + track(m) + "</a>";
        var facts = '<dl class="facts">' +
          "<div><dt>Package</dt><dd>" + esc(p.package) + " <span>· for a " + esc(p.adaptedFor.toLowerCase()) + "</span></dd></div>" +
          "<div><dt>Timeline</dt><dd>" + esc(p.window) + "</dd></div>" +
          "<div><dt>Your team</dt><dd>" + p.team.map(function (x) { return esc(x.name) + " <span>· " + esc(x.role) + "</span>"; }).join("<br>") + "</dd></div>" +
          "</dl>";
        return viewHead(whereInTime(m), "Welcome, " + C.name + ".", esc(C.contact) + ", here's where " + esc(C.name) + " stands.") +
          now + (m.state === "complete" ? asks() : "") + where + facts;
      }
    },

    timeline: {
      label: "Timeline", icon: "timeline",
      state: function (m) { return { text: m.current ? m.current.phase : "Done" }; },
      render: function (m) {
        var ph = phases(m);
        if (!openPhases) {
          openPhases = {};
          var cur = ph.filter(function (p) { return p.status === "now"; })[0];
          if (cur) openPhases[cur.name] = true;
        }
        var list = ph.map(function (p) {
          var open = !!openPhases[p.name];
          var when = p.status === "done" ? "Done " + short(p.end) : p.status === "now" ? "Now, until " + short(p.end) : range(p.start, p.end);
          var steps = p.steps.map(function (s) {
            var sw = s.status === "done" ? "Done " + short(s.end) : s.status === "now" ? "By " + short(s.end) : range(s.start, s.end);
            if (s.id === C.review.step && s.status === "now" && m.reviewOpen && !m.decision) sw = "Your pick";
            return '<li class="step is-' + s.status + '"><span class="mark">' + (s.status === "done" ? I.check : "") + "</span>" +
              '<div><p class="step__name">' + esc(s.name) + '</p><p class="step__desc">' + esc(s.desc) + "</p></div>" +
              '<span class="step__when">' + esc(sw) + "</span></li>";
          }).join("");
          return '<div class="phase is-' + p.status + (open ? " is-open" : "") + '">' +
            '<button class="phase__head" type="button" data-action="phase" data-id="' + esc(p.name) + '" aria-expanded="' + open + '">' +
            '<span class="mark">' + (p.status === "done" ? I.check : "") + "</span>" +
            '<span class="phase__name">' + esc(p.name) + '</span><span class="phase__when">' + esc(when) + "</span>" +
            '<span class="phase__sign" aria-hidden="true"></span></button>' +
            /* a phase with one step is that step: say what it is, once */
            '<div class="phase__wrap"><div class="phase__inner">' +
            (p.steps.length === 1 ? '<p class="phase__desc">' + esc(p.steps[0].desc) + "</p>" : '<ol class="steps">' + steps + "</ol>") +
            "</div></div></div>";
        }).join("");
        var lede = m.current
          ? "Five phases, from your first answers to your final files. We're in <strong>" + esc(m.current.phase.toLowerCase()) + "</strong>."
          : "Every phase done, start to finish.";
        return viewHead("Timeline", m.current ? "Where we are" : "Done, start to finish", lede, link("Save as PDF", "print")) +
          track(m) + '<div class="phases">' + list + "</div>";
      }
    },

    questionnaire: {
      label: "Questionnaire", icon: "questionnaire",
      state: function (m) {
        return m.qSent ? { text: "Sent" } : { action: true, text: m.qStarted ? m.qAnswered + " of " + m.qCount : "To do" };
      },
      render: function (m) {
        if (m.qSent) {
          var mine = C.questions.some(answered) && local.qSentOn;
          return viewHead("Brand discovery", "Questionnaire",
            "Sent " + nice(m.qSent) + ". " + (mine ? "Here's what you told us. Want to change something? Send us a message." : "Your answers are with the studio.")) +
            (mine ? '<dl class="answers">' + C.questions.map(function (q) {
              var a = answerText(q);
              return "<div><dt>" + esc(q.q) + '</dt><dd class="' + (a ? "" : "is-empty") + '">' + esc(a || "Skipped") + "</dd></div>";
            }).join("") + "</dl>" : "");
        }
        var p = m.qAnswered / m.qCount;
        return viewHead("Brand discovery", "Questionnaire",
          "The foundation for everything we make. " + m.qCount + " questions, about " + C.questionnaire.minutes + " minutes, and it saves as you go.") +
          '<div class="qcard"><div class="qcard__meter"><span class="qcard__bar" style="--p:' + (m.qStarted ? p.toFixed(3) : 0) + '"><i></i></span>' +
          (m.qStarted ? m.qAnswered + " of " + m.qCount + " answered" : "Not started") + "</div>" +
          cta(m.qStarted ? "Continue" : "Start the questionnaire", "q-open", true) + "</div>";
      }
    },

    directions: {
      label: "Directions", icon: "directions",
      visible: function (m) { return m.reviewOpen; },
      state: function (m) { return m.decision ? { text: "Decided" } : { action: true, text: "Your pick" }; },
      render: renderDirections
    },

    files: {
      label: "Files", icon: "files",
      state: function (m) {
        return { text: m.ready === m.deliverables.length ? "All ready" : m.ready + " of " + m.deliverables.length };
      },
      render: renderFiles
    },

    payments: {
      label: "Payments", icon: "payments",
      state: function (m) {
        return m.paidInFull ? { text: "Paid" } : m.payDue && m.pay.indexOf(m.payDue) > 0 ? { action: true, text: "Due now" } : { text: "Advance paid" };
      },
      render: renderPayments
    },

    calls: {
      label: "Calls", icon: "calls",
      state: function (m) {
        if (m.state === "kickoff") return { action: true, text: "Book kickoff" };
        return m.nextCall ? { text: m.nextCall.localOnly ? "Booked" : short(m.nextCall.on) } : null;
      },
      render: renderCalls
    },

    messages: {
      label: "Messages", icon: "messages",
      render: function () {
        return viewHead("Anything on your mind", "Ask us anything",
          "A question, a doubt, something you forgot to mention. It goes straight to the studio inbox, and we reply by email.") +
          '<div class="decide">' +
          '<textarea class="field" id="ask" rows="5" aria-label="Your message" placeholder="Write it the way you\'d say it."></textarea>' +
          '<div class="row-actions">' + cta("Send", "mail-ask") +
          '<span class="p-note">Opens your email with the message ready to go.</span></div></div>';
      }
    }
  };
  var ORDER = ["home", "timeline", "questionnaire", "directions", "files", "payments", "calls", "messages"];

  function answerText(q) {
    var v = local.answers[q.id];
    if (q.type === "one") {
      var o = q.options.filter(function (x) { return x.v === v; })[0];
      return o ? o.label : "";
    }
    if (q.type === "many") {
      return (v || []).map(function (id) {
        var o = q.options.filter(function (x) { return x.v === id; })[0];
        return o ? o.label : id;
      }).join(", ");
    }
    if (q.type === "three") return (v || []).filter(function (x) { return String(x).trim(); }).join(", ");
    return v == null ? "" : String(v).trim();
  }

  function renderDirections(m) {
    var D = C.directions;
    sets.slides = D.logo.map(function (o) { return { src: o.slide, alt: o.name, tone: "dark" }; });

    /* once decided, the question is settled: show what was picked, keep
       the other options one tap away */
    if (m.decision) {
      var li = D.logo.map(function (o) { return o.id; }).indexOf(m.decision.logo);
      var lo = D.logo[li], ty = D.type.filter(function (o) { return o.id === m.decision.type; })[0];
      return viewHead("Creative direction", "Directions",
        "Decided " + nice(m.decision.on) + ": <strong>" + esc(lo.name) + "</strong>, with <strong>" + esc(ty.name) + "</strong> for body text.") +
        '<div class="picks is-locked is-decided">' +
        '<div class="pick" aria-checked="true"><img class="pick__img" src="' + esc(lo.img) + '" alt="' + esc(lo.name) + '" decoding="async">' +
        '<div class="pick__body"><span class="pick__name">Logo · ' + esc(lo.name) + '<span class="pick__tick">' + I.check + "</span></span>" +
        '<span class="pick__idea">' + esc(lo.idea) + "</span></div></div>" +
        '<div class="pick" aria-checked="true"><span class="pick__sample" style="font-family:' + esc(ty.css) + '">' + esc(D.typeSample) + "</span>" +
        '<div class="pick__body"><span class="pick__name">Body text · ' + esc(ty.name) + '<span class="pick__tick">' + I.check + "</span></span>" +
        '<span class="pick__idea">' + esc(ty.note) + "</span></div></div></div>" +
        '<div><button class="p-link" type="button" data-action="zoom" data-set="slides" data-i="' + li + '">See all three directions' + I.right + "</button></div>";
    }

    var chosen = local.draftPick || {};
    var logoCards = D.logo.map(function (o, i) {
      return '<div class="pick" role="radio" tabindex="0" aria-checked="' + (chosen.logo === o.id) + '" data-action="pick" data-kind="logo" data-id="' + o.id + '">' +
        '<img class="pick__img" src="' + esc(o.img) + '" alt="' + esc(o.name + ", in dark and light") + '" decoding="async">' +
        '<div class="pick__body"><span class="pick__name">' + String(i + 1).padStart(2, "0") + " · " + esc(o.name) +
        '<span class="pick__tick">' + I.check + "</span></span>" +
        '<span class="pick__idea">' + esc(o.idea) + "</span>" +
        '<button class="pick__more" type="button" data-action="zoom" data-set="slides" data-i="' + i + '">See the full slide</button>' +
        "</div></div>";
    }).join("");
    var typeCards = D.type.map(function (o) {
      return '<div class="pick" role="radio" tabindex="0" aria-checked="' + (chosen.type === o.id) + '" data-action="pick" data-kind="type" data-id="' + o.id + '">' +
        '<span class="pick__sample" style="font-family:' + esc(o.css) + '">' + esc(D.typeSample) + "</span>" +
        '<div class="pick__body"><span class="pick__name">' + esc(o.name) + '<span class="pick__tick">' + I.check + "</span></span>" +
        '<span class="pick__idea">' + esc(o.note) + "</span></div></div>";
    }).join("");

    return viewHead("Creative direction", "Directions",
      "Two choices, and nothing gets built until you make them. Rather talk it through? Decide on the call instead.") +
      '<section><p class="p-sub">01 · Your logo</p><div class="picks" role="radiogroup" aria-label="Logo direction">' + logoCards + "</div></section>" +
      '<section><p class="p-sub">02 · Your body text</p><div class="picks picks--type" role="radiogroup" aria-label="Body typeface">' + typeCards + "</div></section>" +
      '<section class="decide"><label class="p-sub" for="pick-note" style="margin:0">Anything you\'d change? Optional</label>' +
      '<textarea class="field" id="pick-note" rows="3" placeholder="e.g. love the reserve, but could the d be a touch heavier?">' +
      esc((local.draftPick && local.draftPick.note) || "") + "</textarea>" +
      '<div class="row-actions">' + cta("Send my choice", "decide", true) + "</div></section>";
  }

  function renderFiles(m) {
    var ready = m.deliverables.filter(function (x) { return x.status === "ready"; });
    var rest = m.deliverables.filter(function (x) { return x.status !== "ready"; });
    if (!openFolds) {
      /* first visit: the newest finished thing is already open */
      openFolds = {};
      if (ready.length) openFolds[ready[ready.length - 1].id] = true;
    }
    var head = viewHead("Deliverables", "Files",
      ready.length ? "Everything we make for you lands here the moment it's done. Preview it, download it, keep it." : "");

    if (!ready.length) {
      var first = rest[0];
      return head + '<div class="empty"><img src="' + HOSY + 'zen.png" alt="">' +
        "<p>Nothing here yet. Your first files, the <strong>" + esc(first.name.toLowerCase()) + "</strong>, land around <strong>" +
        nice(first.readyOn) + "</strong>. Everything you get will live here, yours to keep.</p></div>" + soon(rest);
    }

    var rows = ready.map(function (x) {
      var open = !!openFolds[x.id];
      var chip = x.fresh ? '<span class="p-chip is-new">New</span>' : '<span class="p-chip is-ready">Ready</span>';
      return '<div class="dl__item' + (open ? " is-open" : "") + '" data-id="' + x.id + '">' +
        '<button class="dl__head" type="button" data-action="fold" data-id="' + x.id + '" aria-expanded="' + open + '" aria-controls="dl-' + x.id + '">' +
        '<span><span class="dl__name">' + esc(x.name) + '</span><span class="dl__desc">' + esc(x.desc) + "</span></span>" +
        chip + '<span class="dl__sign" aria-hidden="true"></span></button>' +
        '<div class="dl__wrap" id="dl-' + x.id + '"><div class="dl__inner"><div class="dl__body">' + deliverableBody(x) + "</div></div></div></div>";
    }).join("");
    return head + '<div class="dl">' + rows + "</div>" + (rest.length ? soon(rest) : "");
  }

  function soon(rest) {
    return '<section><p class="p-sub">Coming next</p><ul class="soon">' + rest.map(function (x) {
      return '<li class="' + (x.status === "progress" ? "is-now" : "") + '">' + esc(x.name) +
        "<span>" + (x.status === "progress" ? "In progress, by " : "Around ") + short(x.readyOn) + "</span></li>";
    }).join("") + "</ul></section>";
  }

  function deliverableBody(x) {
    var out = "";
    if (x.previews && x.previews.length) {
      sets[x.id] = x.previews;
      out += '<div class="shots' + (x.previews.length === 1 ? " shots--one" : "") + '">' + x.previews.map(function (p, i) {
        return '<button class="shot-btn' + (p.tone === "light" ? " is-light" : "") + (p.tall ? " is-tall" : "") +
          '" type="button" data-action="zoom" data-set="' + x.id + '" data-i="' + i + '" aria-label="Preview: ' + esc(p.alt) + '">' +
          '<img src="' + esc(p.src) + '" alt="" loading="lazy" decoding="async"></button>';
      }).join("") + "</div>";
    }
    if (x.palette) {
      out += '<div class="swatches">' + x.palette.map(function (c) {
        return '<button class="swatch" type="button" data-action="copy" data-copy="' + esc(c.hex) + '" aria-label="Copy ' + esc(c.name + " " + c.hex) + '">' +
          '<span class="swatch__chip" style="--c:' + esc(c.hex) + ";--t:" + esc(c.ink) + '"><span class="swatch__hex">' + esc(c.hex) +
          '</span><span class="swatch__name">' + esc(c.name) + "</span></span>" +
          '<span class="swatch__use">' + esc(c.use) + "</span></button>";
      }).join("") + "</div>" + '<p class="p-note">Tap a colour to copy its code.</p>';
    }
    if (x.type) {
      out += '<div class="specimens">' + x.type.map(function (t, i) {
        var cls = i === 0 ? " is-head" : t.role === "Labels" ? " is-label" : "";
        return '<div class="specimen"><div class="specimen__who"><span class="specimen__family">' + esc(t.family) +
          '</span><span class="specimen__role">' + esc(t.role) + "</span></div>" +
          '<p class="specimen__sample' + cls + '" style="font-family:' + esc(t.css) + '">' + esc(t.sample) + "</p>" +
          '<a class="file__get" href="' + esc(t.href) + '" target="_blank" rel="noopener">Get it free' + I.out + "</a></div>";
      }).join("") + "</div>";
    }
    if (x.files && x.files.length) {
      out += '<div class="files">' + x.files.map(function (f) {
        var get = !f.href ? '<span class="file__wait">Uploading shortly</span>'
          : f.external ? '<a class="file__get" href="' + esc(f.href) + '" target="_blank" rel="noopener">Open' + I.out + "</a>"
          : '<a class="file__get" href="' + esc(f.href) + '" download="' + esc(f.download || "") + '">Download' + I.down + "</a>";
        return '<div class="file"><span><span class="file__label">' + esc(f.label) + '</span><span class="file__meta">' + esc(f.meta) + "</span></span>" + get + "</div>";
      }).join("") + "</div>";
    }
    return out;
  }

  function renderPayments(m) {
    var P = C.payments;
    var rows = m.pay.map(function (p) {
      var sub = p.trigger + (p.dueOn && !p.paid ? ", planned " + short(p.dueOn) : "");
      var state = p.paid ? '<span class="p-chip">Paid ' + short(p.paidOn) + "</span>"
        : p.due ? '<span class="p-chip is-action">Due now</span>' : '<span class="p-chip">Not due yet</span>';
      return '<div class="ledger__row"><span><span class="ledger__label">' + esc(p.label) + '</span><span class="ledger__sub">' + esc(sub) + "</span></span>" +
        '<span class="ledger__amt">' + money(p.amount) + '</span><span class="ledger__state">' + state + "</span></div>";
    }).join("");
    var total = '<div class="ledger__row is-total"><span><span class="ledger__label">Total</span><span class="ledger__sub">' +
      esc(C.project.package + " · " + P.note) + '</span></span><span class="ledger__amt">' + money(P.total) + '</span><span class="ledger__state"></span></div>';
    var B = P.bank;
    var bank = m.paidInFull ? '<p class="p-note">Paid in full. Thank you.</p>' :
      '<section><p class="p-sub">Pay by bank transfer</p><dl class="bank">' +
      "<div><dt>Account holder</dt><dd>" + esc(B.holder) + "</dd></div>" +
      "<div><dt>IBAN</dt><dd>" + esc(B.iban) + "<small>" + esc(B.ibanNote) + "</small></dd></div>" +
      "<div><dt>Reference</dt><dd>" + esc(B.reference) + '<button class="copy" type="button" data-action="copy" data-copy="' + esc(B.reference) + '">Copy</button></dd></div>' +
      "</dl></section>";
    return viewHead("Invoice", "Payments", "Two payments, both shown here from day one: half to start, half when everything is delivered.") +
      '<div class="ledger">' + rows + total + "</div>" + bank;
  }

  function renderCalls(m) {
    var list = m.calls.map(function (c) {
      var dt = c.localOnly ? '<span class="call__date"><span class="call__mon">Booked</span></span>'
        : '<span class="call__date"><span class="call__day">' + date(c.on).getDate() + '</span><span class="call__mon">' + F_MON.format(date(c.on)) + "</span></span>";
      var body = '<div><p class="call__name">' + esc(c.name) + (c.localOnly ? "" : ' <span class="call__time">· ' + (day(c.on) === m.t ? "Today, " : "") + clock(c.on) + "</span>") + "</p>";
      body += c.past
        ? '<ul class="call__agreed">' + c.agreed.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>"
        : '<p class="p-note" style="margin-top:0.4rem">The invite is in your inbox. What we agree lands here after the call.</p>';
      body += "</div>";
      if (c.deck) sets["deck-" + c.id] = c.deck.map(function (s) { return { src: s, alt: c.name, tone: "dark" }; });
      var side = c.past && c.deck ? '<button class="p-link" type="button" data-action="zoom" data-set="deck-' + c.id + '" data-i="0">See the deck' + I.right + "</button>"
        : !c.past ? '<span class="p-chip is-now">Booked</span>' : "";
      return '<div class="call' + (c.past ? "" : " is-next") + '">' + dt + body + (side ? "<div>" + side + "</div>" : "") + "</div>";
    }).join("");
    return viewHead("Meeting room", "Calls",
      "Check-ins, questions, or to think something through: thirty minutes, any slot. After each call, what we agreed is written down here.",
      cta("Book a call", "book")) +
      (list ? '<div class="calls">' + list + "</div>" : '<p class="p-note">No calls yet. Your kickoff is the first one.</p>');
  }

  function asks() {
    return '<section class="asks" id="before">' +
      '<div class="ask"><h3>A line about working with us</h3>' +
      "<p>Honest beats glowing. One or two sentences we could quote.</p>" +
      '<textarea class="field" id="quote" rows="4" placeholder="What was it like, and what changed for ' + esc(C.name) + '?"></textarea>' +
      '<label class="check"><input type="checkbox" id="quote-ok"> You can show this on your site, with my name and ' + esc(C.name) + "'s.</label>" +
      '<div class="row-actions">' + cta("Send it", "mail-quote") + "</div></div>" +
      '<div class="ask ask__stack">' +
      '<div class="ask"><h3>Know a founder who needs this?</h3><p>Introduce us by email and we\'ll take it from there.</p>' +
      "<div>" + link("Introduce someone", "mail-intro") + "</div></div>" +
      '<div class="ask"><h3>What\'s next for ' + esc(C.name) + "</h3><p>Now that " + esc(C.name) +
      " looks the part, the work is showing up with it every week. If you want a hand with that, or with anything else, book a call.</p>" +
      "<div>" + link("Book a call", "book") + "</div></div>" +
      "</div></section>";
  }

  /* ---------- sidebar ------------------------------------------------ */

  function visibleViews(m) {
    return ORDER.filter(function (id) { var v = VIEWS[id]; return !v.visible || v.visible(m); });
  }

  function renderSide(m, current) {
    var nav = visibleViews(m).map(function (id) {
      var v = VIEWS[id];
      var st = v.state ? v.state(m) : null;
      return '<li><a href="#' + id + '"' + (id === current ? ' aria-current="page"' : "") + ">" + I[v.icon] +
        "<span>" + esc(v.label) + "</span>" +
        (st ? '<span class="side__state' + (st.action ? " is-action" : "") + '">' + (st.action ? '<span class="p-dot"></span>' : "") + esc(st.text) + "</span>" : "<span></span>") +
        "</a></li>";
    }).join("");
    var studio = !PREVIEW ? "" :
      '<div class="studio" role="group" aria-label="Studio preview"><p class="studio__label">Studio preview<span>only you see this</span></p>' +
      (C.preview || []).map(function (s) {
        return '<button type="button" data-action="stage" data-stage="' + s.id + '" aria-pressed="' + (s.id === stageId) + '"><i></i>' + esc(s.label) + "</button>";
      }).join("") +
      '<button type="button" data-action="stage" data-stage="" aria-pressed="' + (!stageId) + '"><i></i>Today</button>' +
      '<button type="button" class="studio__reset" data-action="stage-reset" title="Forget answers, picks and bookings made in this browser">Reset this browser</button></div>';
    return '<a class="side__studio" href="../"><img src="../assets/logo-mark.png" alt="" width="1039" height="867">Horizon Symmetry</a>' +
      '<div class="side__client"><p class="side__label">Client space</p><p class="side__name">' + esc(C.name) + "</p>" +
      '<p class="side__pkg">' + esc(C.project.package) + "</p></div>" +
      '<nav class="side__nav" aria-label="Client space"><ul>' + nav + "</ul></nav>" +
      '<div class="side__foot">' + studio +
      '<p class="side__help">Need us? <a href="mailto:' + STUDIO.email + '">' + STUDIO.email + "</a></p>" +
      (!VIEWER ? "" :
        '<div class="side__acct"><p class="side__who">' + esc(VIEWER.name || VIEWER.email) +
        (VIEWER.name ? "<span>" + esc(VIEWER.email) + "</span>" : "") + "</p>" +
        '<div class="side__acts">' + (VIEWER.team ? '<a href="space">All clients</a>' : "") +
        '<button type="button" data-action="sign-out">Log out</button></div></div>') +
      '<nav class="side__legal" aria-label="Legal"><a href="../privacy.html">Privacy</a><a href="../terms.html">Terms</a><a href="../cookies.html">Cookies</a></nav>' +
      "</div>";
  }

  /* ---------- draw --------------------------------------------------- */

  var M;
  var shown = null;

  function currentView(m) {
    var h = location.hash.slice(1);
    return visibleViews(m).indexOf(h) > -1 ? h : "home";
  }

  /* `fresh` is a real change of view: scroll to the top, move focus to the
     heading, and play the arrival. A re-render in place (a pick, a sent
     questionnaire) keeps where you are. */
  function render(fresh) {
    M = model();
    var v = currentView(M);
    if (v !== shown) fresh = true;
    shown = v;
    $("#side").innerHTML = renderSide(M, v);
    $("#view").innerHTML = VIEWS[v].render(M);
    $("#view").setAttribute("aria-label", VIEWS[v].label);
    $("#menu-dot").hidden = !M.needsClient;
    document.title = (v === "home" ? "" : VIEWS[v].label + " · ") + C.name + " · Client space · Horizon Symmetry";
    if (fresh) {
      scrollTo(0, 0);
      var h = $(".v-title");
      if (h && document.activeElement && document.activeElement !== document.body) h.focus({ preventScroll: true });
      arrivals();
    }
  }

  /* The site's arrival: slides in from nothing, reaches 82% as it stops,
     and only then comes up to full. Never the expo-out, which reads as
     sharp. (motion-feel in the project notes) */
  function arrivals() {
    if (REDUCED) return;
    Array.prototype.forEach.call($("#view").children, function (el, i) {
      if (!el.animate) return;
      el.animate([
        { opacity: 0, transform: "translateY(16px)", easing: "cubic-bezier(0.22, 0.72, 0.24, 1)" },
        { opacity: 0.82, transform: "none", offset: 0.68 },
        { opacity: 1, transform: "none" }
      ], { duration: 1000, delay: 70 * i, fill: "backwards" });
    });
  }

  addEventListener("hashchange", function () { setMenu(false); render(true); });

  function setMenu(on) {
    document.body.classList.toggle("is-menu", on);
    $("#menu-btn").setAttribute("aria-expanded", on);
  }

  function goTo(sel) {
    var el = $(sel);
    if (el) el.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }

  /* ---------- toast and copy ---------------------------------------- */

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-on"); }, 1900);
  }
  function copy(text) {
    function done() { toast("Copied " + text); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast(text); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* BACKEND: every mailto below becomes a POST to the client's thread
     once there is somewhere to post it. Until then the client's own mail
     app carries it, which at least means nothing is ever lost. */
  function mail(subject, body) {
    location.href = "mailto:" + STUDIO.email + "?subject=" + encodeURIComponent("[" + C.name + "] " + subject) +
      "&body=" + encodeURIComponent(body);
  }

  /* ---------- overlays: shared -------------------------------------- */

  var lastFocus = null;
  function lockPage(on) {
    [".app"].forEach(function (s) { var el = $(s); if (el) el.inert = on; });
    document.documentElement.style.overflow = on ? "hidden" : "";
  }

  /* ---------- lightbox ---------------------------------------------- */

  var lb = { items: [], i: 0 };
  function openLightbox(set, i) {
    lb.items = sets[set] || [];
    if (!lb.items.length) return;
    lb.i = i;
    lastFocus = document.activeElement;
    $("#lb").hidden = false;
    lockPage(true);
    showLightbox();
    $("#lb [data-action=lb-close]").focus();
  }
  function showLightbox() {
    var it = lb.items[lb.i];
    var img = $("#lb-img");
    img.src = it.src;
    img.alt = it.alt || "";
    img.classList.toggle("is-light", it.tone === "light");
    $("#lb-count").textContent = (lb.i + 1) + " / " + lb.items.length;
    var many = lb.items.length > 1;
    $("#lb [data-action=lb-prev]").hidden = !many;
    $("#lb [data-action=lb-next]").hidden = !many;
    if (!REDUCED && img.animate) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
  }
  function closeLightbox() {
    $("#lb").hidden = true;
    lockPage(false);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* ---------- booking ----------------------------------------------- */

  /* Cal.com's own embed, the same one the application form uses, loaded
     only the first time someone asks to book. */
  var calLoaded = false;
  function openCal() {
    lastFocus = document.activeElement;
    setMenu(false);
    $("#calm").hidden = false;
    lockPage(true);
    $("#calm [data-action=cal-close]").focus();
    if (calLoaded) return;
    calLoaded = true;
    (function (W, A, L) {
      var p = function (a, ar) { a.q.push(ar); };
      var d = W.document;
      W.Cal = W.Cal || function () {
        var cal = W.Cal, ar = arguments;
        if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; }
        if (ar[0] === L) {
          var api = function () { p(api, arguments); };
          var ns = ar[1];
          api.q = api.q || [];
          if (typeof ns === "string") { cal.ns[ns] = cal.ns[ns] || api; p(cal.ns[ns], ar); p(cal, ["initNamespace", ns]); }
          else p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, "https://app.cal.com/embed/embed.js", "init");
    window.Cal("init", { origin: "https://cal.com" });
    window.Cal("inline", {
      elementOrSelector: "#cal-inline",
      calLink: STUDIO.cal,
      config: { layout: "month_view", theme: "dark", notes: C.name + ", from the client space" }
    });
    window.Cal("ui", {
      theme: "dark",
      cssVarsPerTheme: { dark: { "cal-brand": "#9B3BE0" } },
      hideEventTypeDetails: matchMedia("(max-width: 640px)").matches,
      layout: "month_view"
    });
    /* BACKEND: Cal's webhook should write the booking to the client's
       record. Until then this browser remembers it. */
    window.Cal("on", {
      action: "bookingSuccessful",
      callback: function () {
        if (!M.kickoffBooked) { local.kickoffBooked = true; save(); }
        setTimeout(function () { closeCal(); render(); toast("Booked. The invite is in your inbox."); }, 1400);
      }
    });
  }
  function closeCal() {
    $("#calm").hidden = true;
    lockPage(false);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* ---------- questionnaire ----------------------------------------- */

  var Q = C.questions;
  var qi = 0;            /* 0 intro, 1..n questions, n+1 review, n+2 sent */
  var qDir = 1;
  var EMO = ["curious", "thinking", "happy", "curious", "winking", "thinking", "pleased", "zen"];

  function openQ() {
    Q.forEach(function (q) {
      if (local.answers[q.id] == null && q.prefill != null) local.answers[q.id] = JSON.parse(JSON.stringify(q.prefill));
    });
    qi = local.qStarted ? Math.min(Math.max(local.qStep || 1, 1), Q.length + 1) : 0;
    lastFocus = document.activeElement;
    $("#qf").hidden = false;
    lockPage(true);
    drawQ();
  }
  function closeQ(silent) {
    $("#qf").hidden = true;
    lockPage(false);
    save();
    render();
    if (!silent && !local.qSentOn && local.qStarted) toast("Saved. Pick up any time.");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function drawQ() {
    var stage = $("#qf-stage");
    var n = Q.length;
    var html;
    var foot = $("#qf-foot");
    var answeredN = Q.filter(answered).length;
    $("#qf-bar").style.setProperty("--p", qi === 0 ? 0 : (qi > n ? 1 : answeredN / n).toFixed(3));
    $("#qf-count").textContent = qi >= 1 && qi <= n ? qi + " / " + n : "";

    if (qi === 0) {
      html = '<div class="qs qs--center"><img class="qs__hosy" src="' + HOSY + 'happy.png" alt="">' +
        '<h2 class="qs__big" id="qf-q">Tell us about ' + esc(C.name) + ".</h2>" +
        '<p class="qs__sub">' + n + " questions, about " + C.questionnaire.minutes + " minutes. We've filled in what we already know. " +
        "Everything saves as you go, so you can stop any time.</p>" +
        cta("Let's go", "q-next", true) + "</div>";
      foot.hidden = true;
    } else if (qi <= n) {
      var q = Q[qi - 1];
      html = '<div class="qs"><div class="qs__head"><img class="qs__hosy" src="' + HOSY + EMO[(qi - 1) % EMO.length] + '.png" alt="">' +
        '<div><h2 class="qs__q" id="qf-q">' + esc(q.q) + "</h2>" + (q.hint ? '<p class="qs__hint">' + esc(q.hint) + "</p>" : "") + "</div></div>" +
        field(q) + '<p class="qs__err" id="qf-err" aria-live="polite"></p></div>';
      foot.hidden = false;
      $("#qf-next .cta__label").textContent = qi === n ? "Review" : !answered(q) && !q.required ? "Skip" : "Next";
      $("#qf-keys").textContent = q.type === "long" ? "⌘ + Enter to continue" : q.type === "one" ? "" : "Enter to continue";
    } else if (qi === n + 1) {
      html = '<div class="qs"><div class="qs__head"><img class="qs__hosy" src="' + HOSY + 'pleased.png" alt="">' +
        '<div><h2 class="qs__q" id="qf-q">Check your answers.</h2><p class="qs__hint">Anything off, change it now. After this it goes to the studio.</p></div></div>' +
        '<dl class="qs__review">' + Q.map(function (q, i) {
          var a = answerText(q);
          return "<div><dt>" + esc(q.q) + '</dt><dd class="' + (a ? "" : "is-empty") + '">' + esc(a || "Skipped") + "</dd>" +
            '<button class="p-link" type="button" data-action="q-edit" data-i="' + (i + 1) + '">Edit</button></div>';
        }).join("") + "</dl></div>";
      foot.hidden = false;
      $("#qf-next .cta__label").textContent = "Send to the studio";
      $("#qf-keys").textContent = "";
    } else {
      var lead = C.project.team[0] ? C.project.team[0].name : "The team";
      html = '<div class="qs qs--center"><img class="qs__hosy" src="' + HOSY + 'celebrating.png" alt="">' +
        '<h2 class="qs__big" id="qf-q">Sent. Thank you.</h2>' +
        '<p class="qs__sub">' + esc(lead) + " reads every answer before your kickoff call. The more honest you were, the sharper the work.</p>" +
        '<div class="row-actions" style="justify-content:center">' +
        (M.kickoffBooked ? cta("Back to your space", "q-close", true) : cta("Book the kickoff call", "q-book", true) + link("Back to your space", "q-close")) +
        "</div></div>";
      foot.hidden = true;
    }
    stage.innerHTML = html;
    stage.scrollTop = 0;
    if (!REDUCED && stage.firstChild.animate) {
      stage.firstChild.animate([
        { opacity: 0, transform: "translateX(" + 28 * qDir + "px)", easing: "cubic-bezier(0.22, 0.72, 0.24, 1)" },
        { opacity: 0.82, transform: "none", offset: 0.68 },
        { opacity: 1, transform: "none" }
      ], { duration: 640 });
    }
    var first = stage.querySelector("textarea, input, .opt, .cta");
    if (first) first.focus({ preventScroll: true });
    if (first && first.tagName === "TEXTAREA") first.setSelectionRange(first.value.length, first.value.length);
  }

  function field(q) {
    var v = local.answers[q.id];
    if (q.type === "long") {
      return '<textarea class="field" data-q="' + q.id + '" rows="4" aria-labelledby="qf-q" placeholder="' + esc(q.placeholder || "") + '">' + esc(v || "") + "</textarea>";
    }
    if (q.type === "three") {
      v = v || ["", "", ""];
      return '<div class="qs__three">' + [0, 1, 2].map(function (i) {
        return '<input class="field" data-q="' + q.id + '" data-k="' + i + '" value="' + esc(v[i] || "") + '" placeholder="' + esc((q.placeholders || [])[i] || "") + '" aria-label="Word ' + (i + 1) + '">';
      }).join("") + "</div>";
    }
    var many = q.type === "many";
    return '<div class="qs__opts" role="' + (many ? "group" : "radiogroup") + '" aria-labelledby="qf-q">' + q.options.map(function (o) {
      var on = many ? (v || []).indexOf(o.v) > -1 : v === o.v;
      return '<button class="opt" type="button" ' + (many ? 'aria-pressed="' + on + '"' : 'role="radio" aria-checked="' + on + '"') +
        ' data-action="q-opt" data-q="' + q.id + '" data-v="' + o.v + '"><span>' + esc(o.label) +
        (o.note ? "<small>" + esc(o.note) + "</small>" : "") + '</span><span class="opt__box">' + I.check + "</span></button>";
    }).join("") + "</div>";
  }

  function qNext() {
    var n = Q.length;
    if (qi >= 1 && qi <= n) {
      var q = Q[qi - 1];
      if (q.required && !answered(q)) {
        $("#qf-err").textContent = "This one we really need. A rough answer is fine.";
        return;
      }
    }
    if (qi === n + 1) return qSend();
    local.qStarted = true;
    qDir = 1;
    qi += 1;
    local.qStep = qi;
    save();
    drawQ();
  }
  function qBack() {
    qDir = -1;
    qi = Math.max(qi - 1, 0);
    if (qi) { local.qStep = qi; save(); }
    drawQ();
  }
  /* BACKEND: POST local.answers to the client's record here. Until the
     login exists nothing leaves the browser, so the studio does not see
     these answers yet. */
  function qSend() {
    local.qSentOn = iso(today);
    save();
    qDir = 1;
    qi = Q.length + 2;
    M = model();
    drawQ();
  }

  /* ---------- events ------------------------------------------------ */

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]");
    if (!a) {
      /* any link in the drawer closes it, even to the view already open */
      if (e.target.closest(".side__nav a")) setMenu(false);
      return;
    }
    switch (a.dataset.action) {
      case "menu": setMenu(!document.body.classList.contains("is-menu")); break;
      case "menu-close": setMenu(false); break;
      case "go": e.preventDefault(); goTo(a.dataset.to); break;
      case "book": openCal(); break;
      case "cal-close": closeCal(); break;
      case "q-open": openQ(); break;
      case "q-close": closeQ(true); break;
      case "q-book": closeQ(true); openCal(); break;
      case "q-next": qNext(); break;
      case "q-back": qBack(); break;
      case "q-edit": qDir = -1; qi = +a.dataset.i; drawQ(); break;
      case "q-opt":
        var q = Q.filter(function (x) { return x.id === a.dataset.q; })[0];
        if (q.type === "many") {
          var list = (local.answers[q.id] || []).slice();
          var at = list.indexOf(a.dataset.v);
          if (at > -1) list.splice(at, 1); else list.push(a.dataset.v);
          local.answers[q.id] = list;
          a.setAttribute("aria-pressed", at < 0);
          $("#qf-next .cta__label").textContent = qi === Q.length ? "Review" : "Next";
        } else {
          local.answers[q.id] = a.dataset.v;
          $$(".opt", a.parentNode).forEach(function (o) { o.setAttribute("aria-checked", o === a); });
          setTimeout(qNext, REDUCED ? 0 : 360);
        }
        save();
        break;
      case "fold":
        var item = a.closest(".dl__item");
        var open = !item.classList.contains("is-open");
        item.classList.toggle("is-open", open);
        a.setAttribute("aria-expanded", open);
        openFolds[a.dataset.id] = open;
        break;
      case "phase":
        var ph = a.closest(".phase");
        var po = !ph.classList.contains("is-open");
        ph.classList.toggle("is-open", po);
        a.setAttribute("aria-expanded", po);
        openPhases[a.dataset.id] = po;
        break;
      case "zoom": e.stopPropagation(); openLightbox(a.dataset.set, +a.dataset.i); break;
      case "lb-close": closeLightbox(); break;
      case "lb-prev": lb.i = (lb.i - 1 + lb.items.length) % lb.items.length; showLightbox(); break;
      case "lb-next": lb.i = (lb.i + 1) % lb.items.length; showLightbox(); break;
      case "copy": copy(a.dataset.copy); break;
      case "pick":
        if (M.decision) return;
        local.draftPick = local.draftPick || {};
        local.draftPick[a.dataset.kind] = a.dataset.id;
        save();
        $$('.pick[data-kind="' + a.dataset.kind + '"]').forEach(function (p) { p.setAttribute("aria-checked", p === a); });
        break;
      case "decide":
        var dp = local.draftPick || {};
        if (!dp.logo || !dp.type) { toast(!dp.logo ? "Pick a logo direction first." : "Pick a face for your body text."); return; }
        /* BACKEND: POST the decision (and the note) to the client's
           record, and tell the studio. */
        var note = $("#pick-note") ? $("#pick-note").value.trim() : "";
        local.review = { logo: dp.logo, type: dp.type, note: note, on: iso(today) };
        save();
        toast("Sent. We start building it now.");
        if (location.hash === "#home") render(true); else location.hash = "#home";
        break;
      case "mail-ask":
        var t = $("#ask").value.trim();
        if (!t) { $("#ask").focus(); toast("Write your message first."); return; }
        mail("Question", t);
        break;
      case "mail-quote":
        var qt = $("#quote").value.trim();
        if (!qt) { $("#quote").focus(); toast("Write a line first."); return; }
        mail("A line about working with you", qt + "\n\n" + ($("#quote-ok").checked ? "OK to show this on your site with my name." : "Please keep this private."));
        break;
      case "mail-intro":
        mail("An introduction", "I'd like to introduce you to:\n\nName:\nEmail:\nWhat they're building:\n");
        break;
      case "print":
        document.body.classList.add("print-view");
        window.print();
        break;
      case "stage":
        stageId = a.dataset.stage;
        today = stageToday();
        var u = new URL(location.href);
        u.searchParams.set("preview", stageId);
        history.replaceState(null, "", u);
        openFolds = null;
        openPhases = null;
        render(true);
        break;
      case "sign-out":
        window.HSAuth.signOut().then(function () { location.replace("login"); });
        break;
      case "stage-reset":
        try { localStorage.removeItem(KEY); } catch (err) { /* nothing to forget */ }
        local = { answers: {} };
        openFolds = null;
        openPhases = null;
        render(true);
        toast("Forgotten. Fresh start.");
        break;
    }
  });

  addEventListener("afterprint", function () { document.body.classList.remove("print-view"); });

  /* answers save on every keystroke */
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.q) {
      var q = Q.filter(function (x) { return x.id === el.dataset.q; })[0];
      if (q.type === "three") {
        var arr = (local.answers[q.id] || ["", "", ""]).slice();
        arr[+el.dataset.k] = el.value;
        local.answers[q.id] = arr;
      } else local.answers[q.id] = el.value;
      save();
      var err = $("#qf-err");
      if (err) err.textContent = "";
      var lbl = $("#qf-next .cta__label");
      if (lbl && qi <= Q.length) lbl.textContent = qi === Q.length ? "Review" : !answered(q) && !q.required ? "Skip" : "Next";
    }
    if (el.id === "pick-note") {
      local.draftPick = local.draftPick || {};
      local.draftPick.note = el.value;
      save();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!$("#lb").hidden) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight" && lb.items.length > 1) { lb.i = (lb.i + 1) % lb.items.length; showLightbox(); }
      if (e.key === "ArrowLeft" && lb.items.length > 1) { lb.i = (lb.i - 1 + lb.items.length) % lb.items.length; showLightbox(); }
      return;
    }
    if (!$("#calm").hidden) { if (e.key === "Escape") closeCal(); return; }
    if (!$("#qf").hidden) {
      if (e.key === "Escape") { closeQ(); return; }
      if (e.key === "Enter" && qi >= 1 && qi <= Q.length) {
        var isArea = e.target.tagName === "TEXTAREA";
        if ((isArea && (e.metaKey || e.ctrlKey)) || (!isArea && e.target.tagName === "INPUT")) { e.preventDefault(); qNext(); }
      }
      return;
    }
    if (e.key === "Escape" && document.body.classList.contains("is-menu")) { setMenu(false); return; }
    /* the direction cards are role=radio divs: give them the keys */
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("pick")) {
      e.preventDefault();
      e.target.click();
    }
  });

  /* ---------- start -------------------------------------------------- */

  (C.fonts || []).forEach(function (f) {
    if (!("FontFace" in window)) return;
    var face = new FontFace(f.family, 'url("' + f.src + '")', { weight: f.weight || "400", style: f.style || "normal", display: "swap" });
    document.fonts.add(face);
    face.load().catch(function () { /* falls back to the stack in the css */ });
  });

  $("#main-name").textContent = C.name;
  render(true);
})();

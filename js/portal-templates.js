/* ===================================================================
   Horizon Symmetry, client space: starting points for a new space

   When the studio makes a space for someone who has just signed up
   (the "Waiting to be connected" list in portal-gate.js), this builds
   the record: steps and dates, questions, payments. It is a sensible
   start for the first day, when the client's job is the questionnaire.
   The details can be changed in the record afterwards.

   Two kinds: a website build (three weeks) and a branding project
   (about two and a half). Dates here are written from a made-up first
   day and moved to the real one. Nothing in this file is about any
   real client.
   =================================================================== */

(function () {
  "use strict";

  var FIRST = "2026-01-05"; /* a Monday: day one of every template */

  var WEB = {
    project: {
      package: "Website build",
      endsWith: "launch day",
      team: [{ name: "Filipp", role: "Your contact" }, { name: "Stas", role: "Horizon Symmetry" }]
    },
    steps: [
      { id: "build", phase: "Build", name: "First build",
        desc: "The look of the pages and a working first version of the site. It doesn't need to be finished: you see it at the check-in.",
        doing: "building the first version", start: "2026-01-05", end: "2026-01-11" },
      { id: "changes", phase: "Changes", name: "Finishing and your first round of changes",
        desc: "We finish the build and make your first round of changes.",
        doing: "finishing the build and making your first changes", start: "2026-01-12", end: "2026-01-18" },
      { id: "final", phase: "Final week", name: "Final changes",
        desc: "Your final changes go in and we test everything.",
        doing: "making the final changes", start: "2026-01-19", end: "2026-01-25" },
      { id: "launch", phase: "Launch", name: "Launch",
        desc: "{{name}} goes live.",
        doing: "launching {{name}}", start: "2026-01-26", end: "2026-01-26" }
    ],
    phases: ["Build", "Changes", "Final week", "Launch"],
    questionnaire: { minutes: 10, label: "About your project", intro: "It tells us what you like, so we design it for you." },
    deliverables: [
      { id: "site", step: "launch", readyOn: "2026-01-26", name: "Website",
        desc: "Every page of the site, live.", kind: "document", previews: [], files: [] }
    ],
    calls: [
      { id: "checkin", bookedOn: "2026-01-05", on: "2026-01-09", name: "Check-in",
        note: "We show you a working first version of the site. What we agree lands here after the call.", agreed: [] },
      { id: "update", bookedOn: "2026-01-05", on: "2026-01-16", name: "Second update",
        note: "The finished build with your first round of changes. What we agree lands here after the call.", agreed: [] }
    ],
    preview: [
      { id: "start", label: "First day", date: "2026-01-05" },
      { id: "changes", label: "Second week", date: "2026-01-14" },
      { id: "launch", label: "Launch day", date: "2026-01-26" }
    ],
    questions: [
      { id: "what", type: "long", required: true, q: "In one line, what is {{name}}?",
        hint: "The way you'd say it to a friend.", placeholder: "What you do, and for whom" },
      { id: "user", type: "long", required: true, q: "Who is the first person you want using it?",
        hint: "Who they are, what they need, where they find you.", placeholder: "e.g. a founder about to launch their first product" },
      { id: "sites", type: "long", required: true, q: "Which websites or apps do you love the look of?",
        hint: "Paste two or three links and say what you like in each.", placeholder: "A link, then what you like about it" },
      { id: "avoid", type: "long", q: "What should it never look or sound like?",
        hint: "A site, a style, a tone. Links help.", placeholder: "Optional" },
      { id: "feel", type: "three", q: "Three words {{name}} should feel like.",
        hint: "First instinct is usually right.", placeholders: ["Clear", "Calm", "Sharp"] },
      { id: "colours", type: "long", q: "Your brand colours: do you have exact colour codes?",
        hint: "Paste them if you do. If not, say so and we'll propose them.", placeholder: "e.g. #0A1B4D, or: you choose" },
      { id: "social", type: "long", q: "Your social media links.",
        hint: "They go in the site footer.", placeholder: "One link per line" },
      { id: "contact", type: "long", q: "Which email should the contact form send to?",
        hint: "Messages from the site's contact page land here.", placeholder: "name@yourcompany.com" },
      { id: "pages", type: "long", q: "Which pages does the site need?",
        hint: "Rough is fine. Tell us what's still undecided.", placeholder: "e.g. home, about, pricing, contact" },
      { id: "extra", type: "long", q: "Anything else we should know before we start?",
        hint: "Never paste passwords here. Accounts and logins we sort out with you directly.", placeholder: "Optional" }
    ]
  };

  var BRAND = {
    project: {
      package: "Branding",
      team: [{ name: "Stas", role: "Brand design" }, { name: "Filipp", role: "Your contact" }]
    },
    steps: [
      { id: "discovery", phase: "Discovery", name: "Discovery",
        desc: "Your answers. We learn the business before we touch the brand.",
        doing: "reading your answers", start: "2026-01-05", end: "2026-01-06" },
      { id: "directions", phase: "Direction", name: "Three directions",
        desc: "Three ways the logo could go, shown to you before anything gets built.",
        doing: "drawing your three directions", start: "2026-01-07", end: "2026-01-12" },
      { id: "logo", phase: "Production", name: "Logo system",
        desc: "Your chosen direction, refined into dark, light, square and favicon versions.",
        doing: "building your logo system", start: "2026-01-13", end: "2026-01-15" },
      { id: "colour", phase: "Production", name: "Colour and typography",
        desc: "The palette and the type, with what each one is for.",
        doing: "setting your colour and type", start: "2026-01-15", end: "2026-01-19" },
      { id: "sheet", phase: "Production", name: "Brand sheet",
        desc: "A short guide on how to use everything.",
        doing: "writing your brand sheet", start: "2026-01-19", end: "2026-01-21" },
      { id: "delivery", phase: "Delivery", name: "Delivery",
        desc: "Every file lands here, yours to keep.",
        doing: "packing up your files", start: "2026-01-22", end: "2026-01-22" }
    ],
    phases: ["Discovery", "Direction", "Production", "Delivery"],
    questionnaire: { minutes: 8, intro: "It is the foundation for everything we make." },
    deliverables: [
      { id: "logo", step: "logo", readyOn: "2026-01-15", name: "Logo system",
        desc: "Dark and light versions, with clear space and a favicon.", kind: "gallery", previews: [], files: [] },
      { id: "colour", step: "colour", readyOn: "2026-01-19", name: "Colour and typography",
        desc: "Your colours and typefaces, with what each one is for.", kind: "document", previews: [], files: [] },
      { id: "sheet", step: "sheet", readyOn: "2026-01-21", name: "Brand sheet",
        desc: "A short guide on how to use everything.", kind: "document", previews: [], files: [] }
    ],
    calls: [
      { id: "checkin", bookedOn: "2026-01-05", on: "2026-01-12", name: "Direction check-in",
        note: "We walk you through the three directions. What we agree lands here after the call.", agreed: [] }
    ],
    preview: [
      { id: "start", label: "First day", date: "2026-01-05" },
      { id: "production", label: "Mid-production", date: "2026-01-16" },
      { id: "delivered", label: "Delivered", date: "2026-01-22" }
    ],
    questions: [
      { id: "what", type: "long", required: true, q: "In one line, what is {{name}}?",
        hint: "The way you'd say it to a friend.", placeholder: "What you do, and for whom" },
      { id: "customers", type: "long", required: true, q: "Who buys from you, or who should?",
        hint: "Roles, industries, where they find you.", placeholder: "e.g. founders launching their first product" },
      { id: "why", type: "long", required: true, q: "Why pick you over what they already use?",
        hint: "The one thing you do that the others don't.", placeholder: "Say it the way you'd say it to a friend" },
      { id: "neighbours", type: "long", q: "Who should you sit next to? And who must you never be confused with?",
        hint: "Brands, products, people. Two or three is plenty.", placeholder: "Optional" },
      { id: "feel", type: "three", q: "Three words {{name}} should feel like.",
        hint: "First instinct is usually right.", placeholders: ["Sharp", "Honest", "Warm"] },
      { id: "ambition", type: "one", q: "How far should the brand push?",
        options: [
          { v: "safe", label: "Safe and credible", note: "Looks established from day one" },
          { v: "bold", label: "Bold but trusted", note: "Stands out, never looks unserious" },
          { v: "defining", label: "Category-defining", note: "Sets the look others copy" }
        ] },
      { id: "where", type: "many", q: "Where will people meet the brand first?", hint: "Pick all that apply.",
        options: [
          { v: "web", label: "A website" }, { v: "social", label: "Social posts" },
          { v: "email", label: "Email inbox" }, { v: "print", label: "Packaging or print" }
        ] },
      { id: "musts", type: "long", q: "Anything we must keep, or must avoid?",
        hint: "Colours, words, an old logo, a look you hate. Paste links too.", placeholder: "Optional" }
    ]
  };

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function parse(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return new Date(+m[1], +m[2] - 1, +m[3]); }
  function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function long(iso, year) { var d = parse(iso); return d.getDate() + " " + MONTHS[d.getMonth()] + (year ? " " + d.getFullYear() : ""); }

  /* opts: kind ("web" | "brand"), id, name, contact, start (ISO day),
     total (a number, or 0 when the price is not set yet: the space then
     has no Payments screen), paid (the first half has already come in) */
  function build(opts) {
    var src = opts.kind === "brand" ? BRAND : WEB;
    var days = Math.round((parse(opts.start) - parse(FIRST)) / 864e5);
    var rec = (function walk(v) {
      if (typeof v === "string") {
        if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v)) {
          var d = parse(v); d.setDate(d.getDate() + days);
          return fmt(d) + v.slice(10);
        }
        return v.split("{{name}}").join(opts.name);
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = walk(v[k]); }); return o; }
      return v;
    })(src);

    rec.id = opts.id;
    rec.name = opts.name;
    rec.contact = opts.contact || opts.name;
    var first = rec.steps[0].start, last = rec.steps[rec.steps.length - 1].end;
    rec.project.window = long(first, parse(first).getFullYear() !== parse(last).getFullYear()) + " to " + long(last, true);

    var total = Math.max(0, Math.round(+opts.total || 0));
    var half = Math.round(total / 2);
    rec.payments = {
      total: total,
      note: "plus VAT, added on each invoice",
      paidLabel: "First half paid",
      lede: "Two payments, both shown here from day one: half to start, half " + (opts.kind === "brand" ? "on delivery." : "at launch."),
      items: [
        opts.paid ? { id: "first", label: "First half", amount: half, trigger: "To start", paidOn: first }
          : { id: "first", label: "First half", amount: half, trigger: "To start", dueOn: first },
        { id: "second", label: "Second half", amount: total - half, trigger: opts.kind === "brand" ? "On delivery" : "At launch", dueOn: last }
      ],
      how: { title: "How to pay", text: "Each payment has its own invoice, sent to you by email. Pay it from the link in that email." }
    };
    return rec;
  }

  window.HS_TEMPLATES = { build: build, kinds: [{ v: "web", label: "A website" }, { v: "brand", label: "Branding" }] };
})();

// Client space: does a WEBSITE-BUILD client's space work end to end?
//
// The space was first built for a branding job (logo directions, a kickoff
// call, payment by bank transfer). A website build has none of those. This
// walks the made-up website client (portal/data/demo.js) through every
// screen in test mode and fills in the whole questionnaire.
//
// Then it runs the same walk against the code as it was before website
// builds were supported, which must fail. A check that can't fail proves
// nothing.
//
// Needs the site on http://localhost:5173, then: node web.test.mjs
// Screenshots go to SHOTS (an absolute folder) when it is set.

import { chromium, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE = "http://localhost:5173";
const SHOTS = process.env.SHOTS || "";
const TODAY = "2026-11-17T10:00:00"; // a fixed day, so the dates on screen are known

let passed = 0, failed = 0;
function check(name, ok, got) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
}

async function walk(engine, label, { oldCode, viewport, shots } = {}) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, deviceScaleFactor: shots ? 2 : 1 });
  const page = await ctx.newPage();
  if (arguments[2] && arguments[2].quick) page.setDefaultTimeout(4000);
  await page.clock.setFixedTime(new Date(TODAY));
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));
  await page.route("**/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "", supabaseKey: "", google: false };` }));
  if (oldCode) await page.route("**/js/portal.js*", r => r.fulfill({ contentType: "text/javascript", body: oldCode }));
  const out = {};
  const shot = async name => { if (shots && SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-${name}.png` }); };

  await page.goto(SITE + "/portal/login");
  await page.fill("input[type=email]", "web@test.hs");
  await page.fill("input[type=password]", "test1234");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/portal\/space/, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => document.getElementById("gate")?.hidden === true, null, { timeout: 8000 }).catch(() => {});
  out.opened = await page.evaluate(() => document.getElementById("gate")?.hidden === true).catch(() => false);
  if (!out.opened) { out.errors = errors; await browser.close(); return out; }
  await page.waitForTimeout(1200);

  const text = sel => page.locator(sel).innerText().catch(() => "");
  out.home = await text("#view");
  // textContent: on a phone the menu sits in a closed drawer
  const nav = () => page.evaluate(() => Array.from(document.querySelectorAll("#side .side__nav li")).map(li => li.textContent.replace(/\s+/g, " ").trim()).join(" | "));
  out.nav = await nav();
  await shot("1-home");

  for (const v of ["timeline", "questionnaire", "files", "payments", "calls", "messages"]) {
    await page.goto(SITE + "/portal/space?c=demo#" + v);
    await page.waitForTimeout(1300);
    out[v] = await text("#view");
    await shot("2-" + v);
  }
  await page.goto(SITE + "/portal/space?c=demo#directions");
  await page.waitForTimeout(600);
  out.directionsFallsHome = await page.evaluate(() => document.querySelector("#view")?.getAttribute("aria-label"));

  // the whole questionnaire, the way a client fills it in
  await page.goto(SITE + "/portal/space?c=demo#home");
  await page.waitForTimeout(800);
  await page.locator('#view [data-action="q-open"]').first().click();
  await page.waitForTimeout(900);
  await shot("3-q-intro");
  await page.locator('#qf-stage [data-action="q-next"]').click();
  let asked = 0, guard = 0;
  while (guard++ < 30) {
    await page.waitForTimeout(750);
    const q = await page.locator("#qf-q").innerText().catch(() => "");
    if (/^Check your answers/.test(q)) break;
    asked++;
    const fields = page.locator("#qf-stage textarea, #qf-stage input");
    const n = await fields.count();
    for (let i = 0; i < n; i++) {
      const f = fields.nth(i);
      if (!(await f.inputValue())) await f.fill("Test answer " + asked + (n > 1 ? "." + (i + 1) : ""));
    }
    if (asked === 3) await shot("3-q-question");
    await page.locator("#qf-next").click();
  }
  out.asked = asked;
  out.review = await text("#qf-stage");
  await shot("3-q-review");
  await page.locator("#qf-next").click();
  await page.waitForTimeout(900);
  out.sent = await text("#qf-stage");
  await shot("3-q-sent");
  await page.locator('#qf-stage [data-action="q-close"]').first().click();
  await page.waitForTimeout(1200);
  out.homeAfter = await text("#view");
  out.navAfter = await nav();
  await shot("4-home-after");
  await page.goto(SITE + "/portal/space?c=demo#questionnaire");
  await page.waitForTimeout(1200);
  out.answers = await text("#view");
  await shot("4-answers");
  out.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  out.errors = errors;
  await browser.close();
  return out;
}

function judge(tag, o) {
  check(`${tag}: the space opens`, o.opened === true, o.errors);
  if (!o.opened) return;
  check(`${tag}: no script errors on any screen`, o.errors.length === 0, o.errors);
  check(`${tag}: home asks for the questionnaire first`, /Tell us about Demo Company/.test(o.home), o.home?.slice(0, 200));
  check(`${tag}: home never offers a kickoff call`, !/kickoff/i.test(o.home), o.home);
  check(`${tag}: no Directions in the menu`, !/Directions/.test(o.nav), o.nav);
  check(`${tag}: asking for #directions shows home`, o.directionsFallsHome === "Home", o.directionsFallsHome);
  check(`${tag}: timeline has the four phases and the right week`, /Four phases/.test(o.timeline) && /Final week/.test(o.timeline) && /Launch/.test(o.timeline), o.timeline?.slice(0, 300));
  check(`${tag}: files show the sample file and what comes next`, /Sample file/.test(o.files) && /Website and web app/.test(o.files), o.files?.slice(0, 300));
  check(`${tag}: payments show two halves of €1,700 and €3,400`, (o.payments.match(/€1,700/g) || []).length === 2 && /€3,400/.test(o.payments), o.payments);
  check(`${tag}: payments say the invoice was sent, not "due now"`, /Invoice sent 16 Nov/i.test(o.payments) && !/Due now/i.test(o.payments), o.payments);
  check(`${tag}: payments never show a bank account`, !/IBAN|bank transfer|Account holder/i.test(o.payments), o.payments);
  check(`${tag}: payments say how to pay`, /How to pay/i.test(o.payments) && /Contra/.test(o.payments), o.payments);
  check(`${tag}: calls list both dates with no made-up time`, /Check-in/.test(o.calls) && /Second update/.test(o.calls) && !/00:00/.test(o.calls), o.calls);
  check(`${tag}: the questionnaire asked all 10 questions`, o.asked === 10, o.asked);
  check(`${tag}: the review screen shows the answers given`, /Test answer 3/.test(o.review) && /hello@democompany\.test/.test(o.review), o.review?.slice(0, 300));
  check(`${tag}: the sent screen names the check-in, not a kickoff`, /check-in on Thu 19 Nov/.test(o.sent) && !/kickoff/i.test(o.sent), o.sent);
  check(`${tag}: after sending, home says we're building`, /building the first version/.test(o.homeAfter), o.homeAfter?.slice(0, 200));
  check(`${tag}: after sending, the menu says Sent`, /Questionnaire ?Sent/.test(o.navAfter), o.navAfter);
  check(`${tag}: the client can read back what they sent`, /Test answer 2/.test(o.answers) && /Sent Tue 17 Nov/.test(o.answers), o.answers?.slice(0, 300));
  check(`${tag}: nothing wider than the screen`, o.overflowX <= 0, o.overflowX);
}

judge("chromium", await walk(chromium, "chromium"));
judge("webkit 1920", await walk(webkit, "webkit-desktop", { shots: true }));
judge("webkit phone", await walk(webkit, "webkit-phone", { viewport: { width: 390, height: 844 }, shots: true }));

// the control: the code from before website builds were supported
const OLD = execFileSync("git", ["-C", ROOT, "show", "ad5ec56:js/portal.js"], { encoding: "utf8" });
const before = passed;
const o = await walk(chromium, "old", { oldCode: OLD, quick: true }).catch(e => ({ opened: false, errors: [String(e.message).split("\n")[0]] }));
const broke = !o.opened || (o.errors || []).length > 0 || /IBAN|kickoff/i.test((o.home || "") + (o.payments || ""));
passed = before;
check("control: the old code fails this walk", broke, { opened: o.opened, errors: o.errors });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Client space: does a new client get through without a detour?
//
// After signing up, the client used to be stuck: their tab said "Check
// your email" and a refresh showed an empty sign-up form, and the "Your
// account is ready" screen never moved on by itself. This walks the ways a
// client actually gets through, in the site's test mode (accounts live in
// the browser, nothing is sent anywhere):
//   1. the email is confirmed somewhere else (phone, the studio): the tab
//      logs itself in, then opens the project the moment the studio connects it
//   2. a reload of "Check your email" keeps the screen and offers Log in
//   3. the link is opened in another tab of the same browser
//   4. "Check now" on the waiting screen
// Then the same walk against the code from before, which must fail.
//
// Needs the site on http://localhost:5173, then: node flow.test.mjs

import { chromium, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE = "http://localhost:5173";
let passed = 0, failed = 0;
function check(name, ok, got) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
}

async function walk(engine, tag, old) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const out = {};
  const errors = [];
  await ctx.route("**/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "", supabaseKey: "", google: false };` }));
  if (old) for (const [file, body] of Object.entries(old))
    await ctx.route(`**/js/${file}*`, r => r.fulfill({ contentType: "text/javascript", body }));
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e.message)));
  await page.clock.install();
  const where = () => page.evaluate(() => {
    const g = document.getElementById("gate"), c = document.querySelector(".auth__card");
    if (g && g.hidden && document.getElementById("main-name")) return "SPACE " + document.getElementById("main-name").textContent;
    return ((g && !g.hidden ? g.innerText : c ? c.innerText : "") || "").replace(/\s+/g, " ");
  }).catch(() => "");
  const wait = async ms => { await page.clock.runFor(ms); await page.waitForTimeout(200); };
  // what "another device" or the studio does: the test-mode accounts live in this browser's storage
  const confirmElsewhere = email => page.evaluate(e => { const a = JSON.parse(localStorage.getItem("hs:test:accounts")); a[e].ok = true; localStorage.setItem("hs:test:accounts", JSON.stringify(a)); }, email);
  const connectElsewhere = (email, space) => page.evaluate(([e, s]) => { const l = JSON.parse(localStorage.getItem("hs:test:links") || "{}"); l[s] = (l[s] || []).concat(e); localStorage.setItem("hs:test:links", JSON.stringify(l)); }, [email, space]);
  async function signUp(name, email) {
    await page.goto(SITE + "/portal/signup"); await wait(500);
    await page.fill("#name", name); await page.fill("#email", email); await page.fill("#password", "test-password-1");
    await page.locator("form button[type=submit]").click(); await wait(800);
  }

  await page.goto(SITE + "/portal/login");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  // 1. confirmed somewhere else, then connected by the studio
  await signUp("Ana Phone", "ana@phone.test");
  out.check = await where();
  out.loginBtn = await page.locator('.auth__state a[href="login"]').count();
  await confirmElsewhere("ana@phone.test");
  await wait(16000);
  out.afterConfirm = await where();
  await connectElsewhere("ana@phone.test", "demo");
  await wait(16000); await page.waitForTimeout(1500); await wait(1000);
  out.afterConnect = await where();
  await page.evaluate(() => window.HSAuth.signOut()); await page.evaluate(() => sessionStorage.clear());

  // 2. a reload of "Check your email"
  await signUp("Ben Reload", "ben@reload.test");
  await page.reload(); await wait(1200);
  out.reloaded = await where();
  out.reloadedLogin = await page.locator('.auth__state a[href="login"]').count();
  // they decide to start over: Log in, then "Create your account" again
  if (old && !out.reloadedLogin) { out.errors = errors; await browser.close(); return out; } /* the old screen has no way on */
  await page.locator('.auth__state a[href="login"]').click(); await wait(800);
  await page.locator('.auth__alt a[href="signup"]').click(); await wait(800);
  out.revisit = await where();

  // 3. the link opened in another tab of this browser
  await signUp("Cleo Tab", "cleo@tab.test");
  const tab2 = await ctx.newPage();
  await tab2.goto(SITE + "/portal/confirm?type=email&test=" + encodeURIComponent("cleo@tab.test"));
  await tab2.waitForTimeout(2500);
  await wait(1500); await page.waitForTimeout(1500);
  out.otherTab = await where();
  await tab2.close();

  // 4. "Check now" while still waiting
  if (/Check now/.test(out.otherTab)) {
    await page.locator("[data-recheck]").click(); await wait(800);
    out.checkNow = await where();
  }
  out.errors = errors;
  await browser.close();
  return out;
}

function judge(tag, o) {
  check(`${tag}: "Check your email" says the page logs them in by itself`, /logs you in by itself/.test(o.check), o.check);
  check(`${tag}: and has a Log in button for a link opened elsewhere`, o.loginBtn === 1, o.loginBtn);
  check(`${tag}: once the email is confirmed elsewhere, the tab logs itself in`, /Your account is ready/.test(o.afterConfirm), o.afterConfirm);
  check(`${tag}: the waiting screen says it opens the project by itself`, /opens right here by itself/.test(o.afterConfirm), o.afterConfirm);
  check(`${tag}: once the studio connects them, the project opens by itself`, o.afterConnect === "SPACE Demo Company", o.afterConnect);
  check(`${tag}: a reload of "Check your email" keeps the screen, not an empty form`, /Check your email/.test(o.reloaded) && !/Create account/.test(o.reloaded), o.reloaded);
  check(`${tag}: and still offers Log in`, o.reloadedLogin === 1, o.reloadedLogin);
  check(`${tag}: coming back to sign up again shows the form, not the old screen`, /Create account/.test(o.revisit || "") && !/Check your email/.test(o.revisit || ""), o.revisit);
  check(`${tag}: a link opened in another tab moves this tab on at once`, /Your account is ready/.test(o.otherTab || ""), o.otherTab);
  check(`${tag}: "Check now" answers when they are not connected yet`, /Not connected yet/.test(o.checkNow || ""), o.checkNow);
  check(`${tag}: no script errors`, (o.errors || []).length === 0, o.errors);
}

judge("chromium", await walk(chromium, "chromium"));
judge("webkit", await walk(webkit, "webkit"));

// the control: the sign-up and waiting screens as they were
const OLD = {
  "portal-login.js": execFileSync("git", ["-C", ROOT, "show", "HEAD:js/portal-login.js"], { encoding: "utf8" }),
  "portal-gate.js": execFileSync("git", ["-C", ROOT, "show", "HEAD:js/portal-gate.js"], { encoding: "utf8" })
};
const before = { passed, failed };
const o = await walk(chromium, "old", OLD).catch(e => ({ crashed: String(e.message).split("\n")[0] }));
const stuck = !/Your account is ready/.test(o.afterConfirm || "") || o.afterConnect !== "SPACE Demo Company" || !/Check your email/.test(o.reloaded || "");
passed = before.passed; failed = before.failed;
check("control: the old screens leave the client stuck", stuck, { afterConfirm: o.afterConfirm, afterConnect: o.afterConnect, reloaded: o.reloaded });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

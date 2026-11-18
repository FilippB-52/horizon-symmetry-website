// Client space: can the studio let a new person in without opening the database?
//
// Two made-up people sign up and see "Your account is ready". The studio
// logs in, finds them under "Waiting to be connected", connects one to an
// existing space and makes a new space for the other. Each then logs in and
// must land in the right place. Runs in the site's test mode, where accounts
// live in the browser, so nothing is sent anywhere. The database's side of
// the same thing (who is allowed to do it) is checked in db.test.mjs.
//
// Needs the site on http://localhost:5173, then: node studio.test.mjs
// Screenshots go to SHOTS (an absolute folder) when it is set.

import { chromium, webkit } from "playwright";

const SITE = "http://localhost:5173";
const SHOTS = process.env.SHOTS || "";
let passed = 0, failed = 0;
function check(name, ok, got) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
}

async function run(engine, tag, viewport) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ viewport })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));
  page.on("dialog", d => d.accept());
  await page.route("**/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "", supabaseKey: "", google: false };` }));
  const shot = async n => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${n}.png`, fullPage: true }); };
  const gateText = async () => (await page.locator("#gate").innerText().catch(() => "")).replace(/\s+/g, " ");
  const settled = () => page.waitForTimeout(1300);

  async function signUp(name, email, confirm) {
    await page.goto(SITE + "/portal/signup");
    await page.fill("#name", name); await page.fill("#email", email); await page.fill("#password", "test-password-1");
    await page.locator("form button[type=submit]").click();
    await page.waitForFunction(() => /Check your email/.test(document.body.innerText));
    if (confirm) {
      await page.goto(SITE + "/portal/confirm?type=email&test=" + encodeURIComponent(email));
      await page.waitForURL(/\/portal\/space/); await settled();
    }
  }
  async function logIn(email, pw) {
    await page.goto(SITE + "/portal/login");
    await page.fill("input[type=email]", email); await page.fill("input[type=password]", pw);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/\/portal\/space/, { timeout: 8000 }).catch(() => {}); await settled();
  }
  async function logOut() { await page.evaluate(() => window.HSAuth.signOut()); }
  const spaceName = () => page.evaluate(() => document.getElementById("gate").hidden ? document.getElementById("main-name").textContent : null);

  await page.goto(SITE + "/portal/login");
  await page.evaluate(() => localStorage.clear());

  await signUp("Anna Waiting", "anna@waiting.test", true);
  check(`${tag}: a new person with no project sees "Your account is ready"`, /Your account is ready/.test(await gateText()), await gateText());
  await logOut();
  await signUp("Boris Late", "boris@late.test", false);

  // the studio
  await logIn("team@test.hs", "test1234");
  await page.waitForSelector(".wait__list");
  const list = await gateText();
  check(`${tag}: the studio sees both under Waiting to be connected`, /Waiting to be connected/.test(list) && /Anna Waiting/.test(list) && /Boris Late/.test(list), list);
  check(`${tag}: it says who has not confirmed their email`, await page.locator('.wait__row:has-text("Boris Late") .wait__warn').count() === 1 && await page.locator('.wait__row:has-text("Anna Waiting") .wait__warn').count() === 0);
  check(`${tag}: existing clients are not listed as waiting`, !/client@test\.hs|web@test\.hs/.test(await page.locator(".wait").innerText()));
  await shot("1-waiting");

  const anna = page.locator('.wait__row:has-text("Anna Waiting")');
  await anna.locator("[data-connect]").click();
  check(`${tag}: pressing Connect with nothing picked asks for a space`, /Pick a space first/.test(await anna.locator(".wait__msg").innerText()));
  await anna.locator("[data-space]").selectOption({ label: "Demo Company" });
  await anna.locator("[data-connect]").click();
  await page.waitForFunction(() => /Anna Waiting is connected to Demo Company/.test(document.querySelector("#gate").innerText));
  check(`${tag}: after connecting, she is no longer waiting`, await page.locator('.wait__row:has-text("Anna Waiting")').count() === 0);

  const boris = page.locator('.wait__row:has-text("Boris Late")');
  await boris.locator("[data-space]").selectOption("+");
  check(`${tag}: choosing A new space opens the short form`, await boris.locator(".wait__new").isVisible());
  await shot("2-new-space-form");
  await boris.locator("[data-connect]").click();
  check(`${tag}: a new space needs a name`, /Give the space a name/.test(await boris.locator(".wait__msg").innerText()));
  await boris.locator("[name=title]").fill("Fresh & Co");
  await boris.locator("[name=start]").fill("2026-11-23");
  await boris.locator("[name=total]").fill("2500");
  await boris.locator("[data-connect]").click();
  await page.waitForFunction(() => /Boris Late is connected to Fresh & Co/.test(document.querySelector("#gate").innerText));
  const after = await gateText();
  check(`${tag}: the new space is in the client list`, /Clients.*Fresh & Co/.test(after), after);
  check(`${tag}: it says he still has to confirm his email`, /still have to confirm their email/.test(after), after);
  check(`${tag}: he is no longer listed as waiting`, await page.locator('.wait__row:has-text("Boris Late")').count() === 0);
  await shot("3-after");
  await logOut();

  // a third person, confirmed by the studio because the email never came
  await signUp("Clara Noemail", "clara@noemail.test", false);
  await logIn("team@test.hs", "test1234");
  await page.waitForSelector(".wait__list");
  await page.locator('.wait__row:has-text("Clara Noemail") [data-confirm]').click();
  await page.waitForFunction(() => /Clara Noemail's email is confirmed/.test(document.querySelector("#gate").innerText));
  check(`${tag}: the studio can confirm an email for someone`, await page.locator('.wait__row:has-text("Clara Noemail") .wait__warn').count() === 0);
  const clara = page.locator('.wait__row:has-text("Clara Noemail")');
  await clara.locator("[data-space]").selectOption("+");
  await clara.locator("[name=title]").fill("Clara Brand");
  await clara.locator("[name=kind]").selectOption("brand");
  await clara.locator("[data-connect]").click();
  await page.waitForFunction(() => /Clara Noemail is connected to Clara Brand/.test(document.querySelector("#gate").innerText));
  await logOut();

  // a test sign-up the studio does not want
  await signUp("Dan Spam", "dan@spam.test", true);
  await logOut();
  await logIn("team@test.hs", "test1234");
  await page.waitForSelector(".wait__list");
  await page.locator('.wait__row:has-text("Dan Spam") [data-remove]').click();
  await page.waitForFunction(() => /dan@spam\.test is removed/.test(document.querySelector("#gate").innerText));
  check(`${tag}: the studio removes an unwanted sign-up`, await page.locator('.wait__row:has-text("Dan Spam")').count() === 0);
  const kept = await gateText();
  check(`${tag}: removing one leaves the clients alone`, /Demo Company/.test(kept) && /Fresh & Co/.test(kept) && /Clara Brand/.test(kept), kept);
  const nope = await page.evaluate(() => window.HSAuth.removeAccount("anna@waiting.test").then(() => "removed", () => "refused"));
  check(`${tag}: a connected client can't be removed this way`, nope === "refused", nope);
  await logOut();
  await page.goto(SITE + "/portal/login");
  await page.fill("input[type=email]", "dan@spam.test"); await page.fill("input[type=password]", "test-password-1");
  await page.locator("form button[type=submit]").click(); await settled();
  check(`${tag}: the removed person can no longer log in`, /don't match/.test(await page.locator("body").innerText()));

  // each of them, as themselves
  await logIn("anna@waiting.test", "test-password-1");
  check(`${tag}: Anna logs in and lands in Demo Company`, await spaceName() === "Demo Company", await gateText());
  await logOut();

  await page.goto(SITE + "/portal/login");
  await page.fill("input[type=email]", "boris@late.test"); await page.fill("input[type=password]", "test-password-1");
  await page.locator("form button[type=submit]").click(); await settled();
  check(`${tag}: Boris can't log in until he confirms his email`, /Confirm your email first/.test(await page.locator("body").innerText()));
  await page.goto(SITE + "/portal/confirm?type=email&test=boris%40late.test");
  await page.waitForURL(/\/portal\/space/); await settled();
  check(`${tag}: once confirmed, Boris lands in Fresh & Co`, await spaceName() === "Fresh & Co", await gateText());
  const seen = {};
  for (const v of ["home", "timeline", "questionnaire", "files", "payments", "calls", "messages"]) {
    await page.goto(SITE + "/portal/space#" + v); await settled();
    seen[v] = (await page.locator("#view").innerText()).replace(/\s+/g, " ");
  }
  check(`${tag}: his new space asks for the questionnaire, by name`, /Tell us about Fresh & Co/.test(seen.home), seen.home.slice(0, 200));
  check(`${tag}: its timeline starts on the day the studio chose`, /23 November to 14 December 2026|23 Nov/.test(seen.home + seen.timeline), seen.timeline.slice(0, 300));
  check(`${tag}: its payments are two halves of the price entered`, (seen.payments.match(/€1,250/g) || []).length === 2 && /€2,500/.test(seen.payments), seen.payments);
  check(`${tag}: its first payment is not shown as late`, !/overdue/i.test(seen.payments));
  await shot("4-new-space-home");
  await page.locator('#view [data-action="q-open"]').first().click().catch(() => {});
  await page.goto(SITE + "/portal/space#questionnaire"); await settled();
  await logOut();

  await logIn("clara@noemail.test", "test-password-1");
  check(`${tag}: Clara, confirmed by the studio, lands in her branding space`, await spaceName() === "Clara Brand", await gateText());
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll("#side .side__nav li")).map(li => li.textContent.replace(/\s+/g, " ").trim()).join(" | "));
  check(`${tag}: with no price entered, her space has no Payments screen`, !/Payments/.test(menu), menu);
  for (const v of ["home", "timeline", "questionnaire", "files", "calls", "messages"]) { await page.goto(SITE + "/portal/space#" + v); await settled(); }
  await logOut();

  // someone who is not the studio must not get the tools
  await logIn("anna@waiting.test", "test-password-1");
  const sneaky = await page.evaluate(async () => {
    const w = await window.HSAuth.waiting();
    const c = await window.HSAuth.connect("crude", "anna@waiting.test").then(() => "let in", () => "refused");
    const r = await window.HSAuth.removeAccount("clara@noemail.test").then(() => "removed", () => "refused");
    return { waiting: w.length, connect: c, remove: r };
  });
  check(`${tag}: a client gets no waiting list, can't connect herself and can't remove anyone`, sneaky.waiting === 0 && sneaky.connect === "refused" && sneaky.remove === "refused", sneaky);
  check(`${tag}: no script errors anywhere`, errors.length === 0, errors);
  await browser.close();
}

await run(chromium, "chromium", { width: 1440, height: 900 });
await run(webkit, "webkit", { width: 1920, height: 1080 });
await run(webkit, "webkit-phone", { width: 390, height: 844 });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

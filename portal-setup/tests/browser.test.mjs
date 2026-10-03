// Client space: does the login and the space behave in a real browser?
//
// Needs the site running on http://localhost:5173 (the `serve` process),
// then: npm run browser
//
// Three setups, none of which sends anything anywhere:
//   test  the pretend accounts on localhost
//   off   the real site before it is connected (reached as hs.test)
//   live  a made-up Supabase project. Every request to it is answered
//         here, from the Crude example record and the files on disk.
//         Anything this file doesn't expect is blocked and counted.
//
// Then the live checks run again against deliberately broken copies of
// the code, and must fail. A check that can't fail proves nothing.

import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE = "http://localhost:5173";
const SB = "https://fake.supabase.co";
const LIB_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
const LIB = readFileSync(new URL("./node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url));
const AUTH_JS = readFileSync(ROOT + "js/portal-auth.js", "utf8");

// the example record, read the way test mode reads it
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "portal/data/crude.js", "utf8"), sandbox);
const RECORD = sandbox.window.HS_CLIENT;
const STATE = { note: "files/crude/logo-light-square.png" }; // an answer that looks like a path

// what the pretend bucket is missing, to prove a gap degrades gracefully
const MISSING_PLAIN = "crude/newsletter-mockup.jpg";
const MISSING_NAMED = "crude/crude-newsletter-mockup.pdf";

let passed = 0, failed = 0;
function check(name, ok, got) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
}

const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP hs.test 127.0.0.1"] });

// Test and off mode are what the site does before it is connected, so
// those pages get an empty config whatever portal/config.js holds now.
async function notConnected(page) {
  await page.route("**/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "", supabaseKey: "", google: false };` }));
  return page;
}

// ------------------------------------------------------------------ test mode
{
  const page = await notConnected(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
  await page.goto(SITE + "/portal/login");
  check("test mode: the login shows the test box", await page.locator("#test-note").isVisible(), "hidden");
  await page.fill("input[type=email]", "client@test.hs");
  await page.fill("input[type=password]", "test1234");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/portal\/space/, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => document.getElementById("gate")?.hidden === true, null, { timeout: 8000 }).catch(() => {});
  check("test mode: client lands in their space", await page.evaluate(() => document.getElementById("gate").hidden), page.url());
  await page.goto(SITE + "/portal/space?c=crude#files");
  const imgs = await loadedImages(page);
  check("test mode: file previews load from the local copy", imgs.length > 0 && imgs.every(i => i.w > 0 && i.url.startsWith(SITE + "/portal/files/crude/")), imgs);
  await page.close();
}

// ------------------------------------------------------------------ off mode
{
  const page = await notConnected(await browser.newPage());
  await page.goto("http://hs.test:5173/portal/space");
  await page.waitForURL(/\/portal\/login/, { timeout: 8000 }).catch(() => {});
  check("off mode: the space sends you to the login", /\/portal\/login/.test(page.url()), page.url());
  check("off mode: no test box on the real site", !(await page.locator("#test-note").isVisible()), "visible");
  const said = await page.locator("main").innerText();
  check("off mode: the login says it isn't open, with no form to try", /Not open yet/.test(said) && (await page.locator("input").count()) === 0, said.slice(0, 200));
  await page.close();
}

// ------------------------------------------------------------------ live mode
async function live({ authJs = AUTH_JS, lib = LIB, storageDown = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const log = { unexpected: [], localFiles: [], signed: 0 };

  // a session already in the browser, as after a real log in
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const jwt = [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: "u1", email: "client@crude.test", role: "authenticated", aud: "authenticated", exp }), "x"].join(".");
  const session = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r",
    user: { id: "u1", email: "client@crude.test", aud: "authenticated", role: "authenticated", user_metadata: { full_name: "Test client" } } };
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-fake-auth-token", JSON.stringify(session)]);

  await ctx.route(SITE + "/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "${SB}", supabaseKey: "sb_publishable_test", google: false };` }));
  await ctx.route(SITE + "/js/portal-auth.js*", r => r.fulfill({ contentType: "text/javascript", body: authJs }));
  await ctx.route(LIB_URL, r => r.fulfill({ contentType: "text/javascript", body: lib,
    headers: { "access-control-allow-origin": "*" } }));
  await ctx.route(SITE + "/portal/files/**", r => { log.localFiles.push(r.request().url()); r.continue(); });

  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

  await ctx.route(SB + "/**", async r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    if (p === "/rest/v1/rpc/is_team") return json(r, false);
    if (p === "/rest/v1/clients" && req.method() === "GET") {
      if (u.searchParams.get("id") === "eq.crude") return json(r, [{ id: "crude", name: RECORD.name, record: RECORD, state: STATE }]);
      return json(r, [{ id: "crude", name: RECORD.name }]);
    }
    if (p === "/rest/v1/clients" && req.method() === "PATCH") return r.fulfill({ status: 204, headers: cors });
    if (p === "/storage/v1/object/sign/client-files" && req.method() === "POST") {
      if (storageDown) return json(r, { error: "down" }, 500);
      const { paths } = req.postDataJSON();
      log.signed += paths.length;
      return json(r, paths.map(path => path === MISSING_PLAIN
        ? { path, error: "Object not found", signedURL: null }
        : { path, error: null, signedURL: `/object/sign/client-files/${path}?token=T` }));
    }
    if (p.startsWith("/storage/v1/object/sign/client-files/") && req.method() === "POST") {
      const path = decodeURIComponent(p.slice("/storage/v1/object/sign/client-files/".length));
      if (storageDown || path === MISSING_NAMED) return json(r, { statusCode: "404", error: "not_found", message: "Object not found" }, 400);
      log.signed++;
      return json(r, { signedURL: `/object/sign/client-files/${path}?token=T` });
    }
    if (p.startsWith("/storage/v1/object/sign/client-files/") && req.method() === "GET" && u.searchParams.get("token") === "T") {
      const file = ROOT + "portal/files/" + decodeURIComponent(p.slice("/storage/v1/object/sign/client-files/".length));
      if (!existsSync(file)) return r.fulfill({ status: 404, headers: cors });
      return r.fulfill({ status: 200, headers: cors, body: readFileSync(file) });
    }
    log.unexpected.push(req.method() + " " + p);
    return r.abort();
  });

  const page = await ctx.newPage();
  await page.goto(SITE + "/portal/space#files");
  const opened = await page.waitForFunction(() => document.getElementById("gate")?.hidden === true, null, { timeout: 8000 }).then(() => true, () => false);
  let out = { opened, log };
  if (opened) {
    const imgs = await loadedImages(page);
    const links = await page.$$eval("a.file__get[download]", as => as.map(a => a.href));
    const waits = await page.locator(".file__wait").count();
    const fonts = await page.evaluate(async () => {
      await Promise.all(Array.from(document.fonts).filter(f => /^"?Crude/.test(f.family)).map(f => f.load().catch(() => {})));
      return Array.from(document.fonts).filter(f => /^"?Crude/.test(f.family)).map(f => f.status);
    });
    const state = await page.evaluate(() => window.HS_CLIENT && window.HS_CLIENT.state);
    out = { ...out, imgs, links, waits, fonts, state };
  }
  await ctx.close();
  return out;
}

async function loadedImages(page) {
  // the gallery lazy-loads: scroll the whole view, then measure
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  return page.$$eval("#view img", is => is.map(i => ({ src: i.getAttribute("src") || "", url: i.src, w: i.naturalWidth })));
}

const SIGNED = SB + "/storage/v1/object/sign/client-files/crude/";

function liveChecks(tag, r) {
  const ok = [];
  const add = (name, cond, got) => ok.push([`${tag}: ${name}`, cond, got]);
  add("the space opens", r.opened, r.log.unexpected);
  if (!r.opened) return ok;
  const withSrc = r.imgs.filter(i => i.src);
  add("every preview comes from a private signed link", withSrc.length > 0 && withSrc.every(i => i.src.startsWith(SIGNED) && i.src.includes("token=")), withSrc.map(i => i.src).slice(0, 3));
  add("and actually draws", withSrc.every(i => i.w > 0), withSrc.filter(i => !i.w).map(i => i.src));
  add("nothing is fetched from the public files folder", r.log.localFiles.length === 0, r.log.localFiles);
  add("a file missing from the bucket shows nothing, not a public path", r.imgs.some(i => i.src === "") && !r.imgs.some(i => i.src.includes("newsletter-mockup.jpg")), r.imgs.map(i => i.src.slice(0, 60)));
  add("the logo package downloads under its proper name", r.links.some(h => h.startsWith(SIGNED + "crude-logo-package.zip") && new URL(h).searchParams.get("download") === "Crude - Full Logo Package.zip"), r.links);
  add("a missing download says Uploading shortly", r.waits >= 2, r.waits); // the brand sheet (never had a file) + the missing PDF
  add("the client's fonts load from the bucket", r.fonts.length === 5 && r.fonts.every(s => s === "loaded"), r.fonts);
  add("their answers are left alone", r.state && r.state.note === STATE.note, r.state);
  add("no request the fake project didn't expect", r.log.unexpected.length === 0, r.log.unexpected);
  return ok;
}

const real = await live();
for (const c of liveChecks("live", real)) check(...c);

const down = await live({ storageDown: true });
check("live, storage down: the space still opens", down.opened, down.log.unexpected);
check("live, storage down: every download says Uploading shortly", down.waits >= 3, down.waits);
check("live, storage down: still nothing from the public files folder", down.log.localFiles.length === 0, down.log.localFiles);

// ------------------------------------------------------------------ sabotage
function swap(src, from, to) {
  if (src.split(from).length !== 2) throw new Error("sabotage text not found once: " + from);
  return src.replace(from, to);
}
const SABOTAGE = [
  { what: "the space skips signing and uses the plain paths",
    run: () => live({ authJs: swap(AUTH_JS, "return signFiles(c, rec, rec.id);", "return rec;") }),
    mustFail: ["every preview comes from a private signed link", "nothing is fetched from the public files folder"] },
  { what: "a failed file falls back to its public path",
    run: () => live({ authJs: swap(AUTH_JS, '(f.name ? f.url : urls[f.path]) || ""', '(f.name ? f.url : urls[f.path]) || f.o[f.k]') }),
    mustFail: ["a file missing from the bucket shows nothing, not a public path"] },
  { what: "the answers get walked too",
    run: () => live({ authJs: swap(AUTH_JS, 'if (o === rec && k === "state") return;', "") }),
    mustFail: ["their answers are left alone"] },
  { what: "the Supabase library on the CDN changes",
    run: () => live({ lib: Buffer.concat([LIB, Buffer.from("\n/* tampered */")]) }),
    mustFail: ["the space opens"] },
];
for (const s of SABOTAGE) {
  const tripped = liveChecks("x", await s.run()).filter(c => !c[1]).map(c => c[0].slice(3));
  const missed = s.mustFail.filter(n => !tripped.includes(n));
  check(`sabotage caught: ${s.what}`, missed.length === 0, { missed, tripped });
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Client space: can the team share files and links from a client's Files
// view, and can the client and the team talk about each one?
//
// Walks it in test mode, as both sides, on the made-up website client
// (portal/data/demo.js, opened by web@test.hs):
//   team    adds a link with a note, then two files, under one heading
//   client  sees them, opens the link, comments on it
//   team    sees "Reply" in the client list and on the item, answers
//   client  sees the answer, deletes their own comment
//   team    removes a file
//
// Then runs the team's half against the code as it was before sharing
// existed, which must fail. A check that can't fail proves nothing.
//
// Needs the site on http://localhost:5173, then: node shared.test.mjs
// Screenshots go to SHOTS (an absolute folder) when it is set.

import { chromium, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE = "http://localhost:5173";
const SHOTS = process.env.SHOTS || "";

let passed = 0, failed = 0;
function check(name, ok, got) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
}

async function login(page, email) {
  await page.goto(SITE + "/portal/login");
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", "test1234");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/portal\/space/, { timeout: 8000 }).catch(() => {});
}
async function openSpace(page, id) {
  await page.goto(SITE + "/portal/space?c=" + id + "#files");
  await page.waitForFunction(() => document.getElementById("gate")?.hidden === true, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function walk(engine, tag, { oldCode } = {}) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.route("**/portal/config.js*", r => r.fulfill({ contentType: "text/javascript",
    body: `window.HS_PORTAL = { supabaseUrl: "", supabaseKey: "", google: false };` }));
  if (oldCode) await ctx.route("**/js/portal.js*", r => r.fulfill({ contentType: "text/javascript", body: oldCode }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));
  page.on("dialog", d => d.accept());
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, fullPage: true }); };
  const out = { errors };
  try {
    // ---- the team adds things
    await login(page, "team@test.hs");
    await openSpace(page, "demo");
    out.formButton = await page.locator("[data-action=share-open]").count();
    await page.click("[data-action=share-open]");
    await page.click("[data-action=share-kind][data-kind=link]");
    await page.fill("#sh-form [name=section]", "First build");
    await page.fill("#sh-form [name=url]", "preview.example.com/site");
    await page.fill("#sh-form [name=title]", "Website preview");
    await page.fill("#sh-form [name=note]", "Password: lens2026");
    await shot("1-team-form");
    await page.click("#sh-form button[type=submit]");
    await page.waitForSelector(".sh-item", { timeout: 6000 });
    out.linkHref = await page.locator(".sh-item .file__get").first().getAttribute("href");

    await page.click("[data-action=share-open]");
    // the heading just used is offered again
    out.sectionKept = await page.inputValue("#sh-form [name=section]");
    await page.click("[data-action=share-kind][data-kind=file]");
    await page.setInputFiles("#sh-form [name=file]", [
      { name: "Brand book v1.1.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") },
      { name: "Logo files.zip", mimeType: "application/zip", buffer: Buffer.from("PK test") }
    ]);
    await page.click("#sh-form button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll(".sh-item").length === 3, null, { timeout: 8000 }).catch(() => {});
    out.teamTitles = await page.$$eval(".sh-item .file__label", els => els.map(e => e.childNodes[0].textContent));
    out.groups = await page.$$eval(".sh-head", els => els.map(e => e.textContent));
    out.downloadName = await page.locator(".sh-item a[download]").first().getAttribute("download");

    // a bad link is refused on the form, nothing is added
    await page.click("[data-action=share-open]");
    await page.click("[data-action=share-kind][data-kind=link]");
    await page.fill("#sh-form [name=url]", "not a link");
    await page.fill("#sh-form [name=title]", "Broken");
    await page.click("#sh-form button[type=submit]");
    out.badLinkMsg = await page.locator("#sh-msg").textContent();
    out.afterBad = await page.locator(".sh-item").count();
    await page.click("[data-action=share-open]");
    await shot("2-team-added");

    // ---- the client sees them and comments
    await page.click("[data-action=sign-out]").catch(() => {});
    await page.waitForURL(/login/, { timeout: 6000 }).catch(() => {});
    await login(page, "web@test.hs");
    await openSpace(page, "demo");
    out.clientNav = await page.evaluate(() => Array.from(document.querySelectorAll("#side .side__nav li")).map(li => li.textContent.replace(/\s+/g, " ").trim()).join(" | "));
    out.clientTitles = await page.$$eval(".sh-item .file__label", els => els.map(e => e.childNodes[0].textContent));
    out.clientForm = await page.locator("[data-action=share-open]").count();
    out.clientRemove = await page.locator("[data-action=unshare]").count();
    out.clientNote = await page.locator(".sh-note").first().textContent().catch(() => "");
    // one big box under the heading, after the items
    out.layout = await page.evaluate(() => {
      const g = document.querySelector(".sh-group"), kids = Array.from(g.children).map(k => k.className);
      const t = g.querySelector(".sh-talk textarea");
      return { order: kids.join(" > "), boxes: document.querySelectorAll(".sh-talk textarea").length, perItem: document.querySelectorAll(".sh-item textarea").length, h: t.getBoundingClientRect().height };
    });
    const box = page.locator(".sh-talk textarea").first();
    await box.click();
    await page.keyboard.type("Can we make the hero photo warmer?");
    // Enter and Shift+Enter start new lines; nothing is sent
    for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? "Shift+Enter" : "Enter"); await page.keyboard.type("And another thought, line " + (i + 2) + "."); }
    out.typed = await page.evaluate(() => { const t = document.querySelector(".sh-talk textarea"); return { lines: t.value.split("\n").length, h: t.getBoundingClientRect().height, scroll: t.scrollHeight, client: t.clientHeight, sent: document.querySelectorAll(".sh-c").length }; });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await page.waitForSelector(".sh-c", { timeout: 6000 });
    out.clientComment = await page.locator(".sh-c").first().innerText();
    await shot("3-client");

    // ---- the team sees it waiting, and answers
    await page.click("[data-action=sign-out]").catch(() => {});
    await page.waitForURL(/login/, { timeout: 6000 }).catch(() => {});
    await login(page, "team@test.hs");
    await page.waitForSelector(".gate__waiting", { timeout: 6000 }).catch(() => {});
    out.listNote = await page.locator('.gate__list li[data-id="demo"] .gate__waiting').textContent().catch(() => "");
    await openSpace(page, "demo");
    out.teamNav = await page.evaluate(() => Array.from(document.querySelectorAll("#side .side__nav li")).map(li => li.textContent.replace(/\s+/g, " ").trim()).join(" | "));
    out.replyChip = await page.locator(".sh-head .p-chip.is-action").count();
    const tbox = page.locator(".sh-talk textarea").first();
    await tbox.fill("Yes, warming it up today.");
    await page.locator(".sh-talk .sh-reply button[type=submit]").first().click();
    await page.waitForFunction(() => document.querySelectorAll(".sh-c").length === 2, null, { timeout: 6000 }).catch(() => {});
    out.teamReply = await page.locator(".sh-c.is-team").first().innerText().catch(() => "");
    out.replyChipAfter = await page.locator(".sh-head .p-chip.is-action").count();
    // remove one file
    await page.locator('.sh-item:has-text("Logo files") [data-action=unshare]').click();
    await page.waitForFunction(() => document.querySelectorAll(".sh-item").length === 2, null, { timeout: 6000 }).catch(() => {});
    out.afterRemove = await page.$$eval(".sh-item .file__label", els => els.map(e => e.childNodes[0].textContent));
    out.commentsAfterRemove = await page.locator(".sh-c").count();
    await shot("4-team-replied");
    // the team switches to exactly what the client sees, and back
    await page.click("[data-action=as-client]");
    await page.waitForTimeout(300);
    out.asClient = { add: await page.locator("[data-action=share-open]").count(), remove: await page.locator("[data-action=unshare]").count(),
      studio: await page.locator(".studio").count(), reply: await page.locator(".sh-head .p-chip.is-action").count(),
      del: await page.locator(".sh-c [data-action=uncomment]").count(), bar: await page.locator(".asbar").innerText() };
    await page.reload();
    await page.waitForFunction(() => document.getElementById("gate")?.hidden === true, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    out.asClientKept = await page.locator(".asbar.is-client").count();
    await page.click("[data-action=as-client]");
    await page.waitForTimeout(300);
    out.backToStudio = { add: await page.locator("[data-action=share-open]").count(), remove: await page.locator("[data-action=unshare]").count() };

    // ---- the client sees the answer, deletes their own comment, can't delete ours
    await page.click("[data-action=sign-out]").catch(() => {});
    await page.waitForURL(/login/, { timeout: 6000 }).catch(() => {});
    await login(page, "web@test.hs");
    await openSpace(page, "demo");
    out.clientSees = await page.$$eval(".sh-c", els => els.map(e => e.innerText.replace(/\s+/g, " ")));
    out.clientDeleteButtons = await page.locator(".sh-c [data-action=uncomment]").count();
    await page.locator(".sh-c [data-action=uncomment]").first().click();
    await page.waitForFunction(() => document.querySelectorAll(".sh-c").length === 1, null, { timeout: 6000 }).catch(() => {});
    out.clientAfterDelete = await page.$$eval(".sh-c", els => els.map(e => e.innerText.replace(/\s+/g, " ")));
  } catch (e) {
    out.crashed = String(e.message).split("\n")[0];
  }
  await browser.close();
  return out;
}

function checks(tag, o) {
  check(`${tag}: the team gets an add button in Files`, o.formButton === 1, o.formButton);
  check(`${tag}: a link typed without https:// is added with it`, o.linkHref === "https://preview.example.com/site", o.linkHref);
  check(`${tag}: the heading just used is offered again`, o.sectionKept === "First build", o.sectionKept);
  check(`${tag}: two files and a link sit under one heading`, JSON.stringify(o.groups) === '["First build"]' && (o.teamTitles || []).join(",") === "Website preview,Brand book v1.1,Logo files", { groups: o.groups, titles: o.teamTitles });
  check(`${tag}: a file downloads under its own name`, o.downloadName === "Brand book v1.1.pdf", o.downloadName);
  check(`${tag}: a broken link is refused and nothing is added`, /doesn't look like a link/.test(o.badLinkMsg || "") && o.afterBad === 3, { msg: o.badLinkMsg, n: o.afterBad });
  check(`${tag}: the client sees all three, with the note`, (o.clientTitles || []).length === 3 && o.clientNote === "Password: lens2026", { t: o.clientTitles, n: o.clientNote });
  check(`${tag}: the client sees them marked new in the menu`, /Files\s*New/.test(o.clientNav || ""), o.clientNav);
  check(`${tag}: the client can't add or remove anything`, o.clientForm === 0 && o.clientRemove === 0, { form: o.clientForm, remove: o.clientRemove });
  check(`${tag}: items first, then one comment section under the heading`, !!o.layout && /^sh-head > sh-items > sh-talk$/.test(o.layout.order) && o.layout.boxes === 1 && o.layout.perItem === 0, o.layout);
  check(`${tag}: the comment box starts big (about five lines or more)`, !!o.layout && o.layout.h >= 150, o.layout && o.layout.h);
  check(`${tag}: Enter and Shift+Enter add lines without sending`, !!o.typed && o.typed.lines === 7 && o.typed.sent === 0, o.typed);
  check(`${tag}: the box grows with what is written, never scrolls inside`, !!o.typed && o.typed.h > o.layout.h && o.typed.scroll <= o.typed.client + 4, { before: o.layout && o.layout.h, after: o.typed });
  check(`${tag}: the client's comment shows as theirs`, /^You/.test(o.clientComment || "") && /hero photo warmer/.test(o.clientComment || "") && /line 7/.test(o.clientComment || ""), o.clientComment);
  check(`${tag}: the team's client list says a comment is waiting`, /New comment/.test(o.listNote || ""), o.listNote);
  check(`${tag}: the team sees Reply in the menu and on the heading`, /Files\s*Reply/.test(o.teamNav || "") && o.replyChip === 1, { nav: o.teamNav, chip: o.replyChip });
  check(`${tag}: the team's answer is signed Horizon Symmetry`, /^Horizon Symmetry/.test(o.teamReply || "") && /warming it up/.test(o.teamReply || "") && o.replyChipAfter === 0, { reply: o.teamReply, chip: o.replyChipAfter });
  check(`${tag}: seen as the client, nothing team-only shows`, !!o.asClient && o.asClient.add === 0 && o.asClient.remove === 0 && o.asClient.studio === 0 && o.asClient.reply === 0 && o.asClient.del === 0 && /exactly what/.test(o.asClient.bar), o.asClient);
  check(`${tag}: the client view survives a reload, and switches back`, o.asClientKept === 1 && !!o.backToStudio && o.backToStudio.add === 1 && o.backToStudio.remove === 2, { kept: o.asClientKept, back: o.backToStudio });
  check(`${tag}: the team removes a file, the conversation stays`, (o.afterRemove || []).join(",") === "Website preview,Brand book v1.1" && o.commentsAfterRemove === 2, { items: o.afterRemove, comments: o.commentsAfterRemove });
  check(`${tag}: the client sees the answer and can delete only their own`, (o.clientSees || []).length === 2 && o.clientDeleteButtons === 1, { sees: o.clientSees, del: o.clientDeleteButtons });
  check(`${tag}: their own comment goes, ours stays`, (o.clientAfterDelete || []).length === 1 && /Horizon Symmetry/.test(o.clientAfterDelete[0]), o.clientAfterDelete);
  check(`${tag}: no page errors`, !o.crashed && o.errors.length === 0, { crashed: o.crashed, errors: o.errors });
}

for (const [engine, tag] of [[webkit, "webkit"], [chromium, "chromium"]]) checks(tag, await walk(engine, tag));

// ---- control: the code before sharing existed (the commit before e32cd7c) must fail the team's half
const OLD = execFileSync("git", ["-C", ROOT, "show", "e32cd7c~1:js/portal.js"], { encoding: "utf8" });
const old = await walk(chromium, "old", { oldCode: OLD });
check("control: the old Files view has no way to share", old.formButton !== 1 && !!old.crashed, { form: old.formButton, crashed: old.crashed });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

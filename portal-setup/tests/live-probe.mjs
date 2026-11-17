// Client space: does the LIVE database keep a client in their own space?
//
// Logs in to the real Supabase project as a made-up client and tries to
// get at things that client must never reach. Every "refused" check sits
// next to a check that the same kind of request DOES work on the client's
// own space, so a refusal means the rules said no, not that the request
// was broken.
//
// Run it as a client that already exists. PROBE_SPACE is the one space
// that login is linked to; PROBE_HIDDEN are other spaces in the database
// that it must never see. It needs at least one file in its own folder.
//
// Nothing is written unless PROBE_WRITE=1, which saves the space's own
// answers back unchanged (the control that saving works at all). Never
// set it for a real client's space.
//
//   PROBE_EMAIL=... PROBE_PASSWORD=... PROBE_SPACE=crude PROBE_HIDDEN=demo,another-client node live-probe.mjs

import { readFileSync } from "node:fs";

const cfg = readFileSync(new URL("../../portal/config.js", import.meta.url), "utf8");
const URL_ = cfg.match(/supabaseUrl:\s*"([^"]+)"/)[1];
const KEY = cfg.match(/supabaseKey:\s*"([^"]+)"/)[1];
const EMAIL = (process.env.PROBE_EMAIL || "").toLowerCase();
const PASSWORD = process.env.PROBE_PASSWORD || "";
const OWN = process.env.PROBE_SPACE || "crude";
const HIDDEN = (process.env.PROBE_HIDDEN || "demo").split(",").map(x => x.trim()).filter(Boolean);
const WRITE = process.env.PROBE_WRITE === "1";
if (!EMAIL || !PASSWORD) { console.error("set PROBE_EMAIL and PROBE_PASSWORD"); process.exit(2); }

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "pass  " : "FAIL  ") + name + (ok || detail == null ? "" : "   -> " + detail));
}

async function call(path, { method = "GET", token, body, headers = {}, raw } = {}) {
  const h = { apikey: KEY, ...headers };
  if (token) h.Authorization = "Bearer " + token;
  if (body !== undefined && !raw) h["Content-Type"] = "application/json";
  let r;
  try {
    r = await fetch(URL_ + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  } catch (e) {
    return { status: 0, json: null, text: "no answer: " + ((e.cause && e.cause.code) || e.message) };
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const refused = r => r.status === 401 || r.status === 403 || (r.json && r.json.code === "42501");
const short = r => r.status + " " + r.text.slice(0, 160);

// ---------------------------------------------------------- logged out
const ping = await call("/rest/v1/rpc/ping", { method: "POST", body: {} });
check("the project is awake (ping answers 1)", ping.status === 200 && ping.json === 1, short(ping));
if (ping.status !== 200) { console.log("\nThe project is not answering. Nothing else can be checked."); process.exit(1); }

const settings = await call("/auth/v1/settings");
check("'Confirm email' is on (nobody is let in unconfirmed)", settings.json && settings.json.mailer_autoconfirm === false, short(settings));

check("logged out: clients table refused", refused(await call("/rest/v1/clients?select=id")));
check("logged out: team list refused", refused(await call("/rest/v1/team_members?select=email")));
const pub = await call("/storage/v1/object/public/client-files/crude/logo-dark-square.png");
check("logged out: a client's file has no public address", pub.status !== 200, short(pub));

// ---------------------------------------------------------- as the probe
const login = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
const T = login.json && login.json.access_token;
check("the probe client can log in", !!T, short(login));
if (!T) process.exit(1);

const me = await call("/rest/v1/rpc/my_email", { method: "POST", token: T, body: {} });
check("the database knows who this is", me.json === EMAIL, short(me));
const team = await call("/rest/v1/rpc/is_team", { method: "POST", token: T, body: {} });
check("the probe client is not treated as the team", team.json === false, short(team));

const all = await call("/rest/v1/clients?select=id,name,emails,state", { token: T });
const ids = (all.json || []).map(r => r.id);
check(`sees exactly one space, its own (${OWN})`, ids.length === 1 && ids[0] === OWN, short(all));
const own = (all.json || [])[0] || {};
for (const h of HIDDEN) {
  const r = await call("/rest/v1/clients?select=id&id=eq." + h, { token: T });
  check(`asking for "${h}" by name returns nothing`, r.status === 200 && Array.isArray(r.json) && r.json.length === 0, short(r));
}
check("team list refused", refused(await call("/rest/v1/team_members?select=email", { token: T })));

const ret = { Prefer: "return=representation" };
if (WRITE) {
  const st = await call("/rest/v1/clients?id=eq." + OWN, { method: "PATCH", token: T, headers: ret, body: { state: own.state || {} } });
  check("CAN save answers in its own space (control)", st.status === 200 && Array.isArray(st.json) && st.json.length === 1, short(st));
}
// its own row: only answers may change. Each attempt sends the value the row already holds.
check("can't rename its own space", refused(await call("/rest/v1/clients?id=eq." + OWN, { method: "PATCH", token: T, headers: ret, body: { name: own.name } })));
check("can't change who is linked to its space", refused(await call("/rest/v1/clients?id=eq." + OWN, { method: "PATCH", token: T, headers: ret, body: { emails: own.emails } })));
check("can't change its own record (steps, prices, files)", refused(await call("/rest/v1/clients?id=eq." + OWN, { method: "PATCH", token: T, headers: ret, body: { record: {} } })));
// other clients' rows. If a rule were broken, this would blank that space's ANSWERS only, so it
// aims at the first hidden space, which should be the made-up one.
if (HIDDEN[0]) {
  const other = await call("/rest/v1/clients?id=eq." + HIDDEN[0] + "&select=id", { method: "PATCH", token: T, headers: ret, body: { updated_at: "2000-01-01" } });
  check(`can't write into another client's space (${HIDDEN[0]})`, refused(other) || (Array.isArray(other.json) && other.json.length === 0), short(other));
}
const ins = await call("/rest/v1/clients", { method: "POST", token: T, headers: ret, body: { id: "probe-c", name: "x", record: {} } });
check("can't create a space", refused(ins), short(ins));
const del = await call("/rest/v1/clients?id=eq.does-not-exist", { method: "DELETE", token: T, headers: ret });
check("can't delete a space", refused(del), short(del));

// files
const root = await call("/storage/v1/object/list/client-files", { method: "POST", token: T, body: { prefix: "", limit: 100 } });
const folders = (root.json || []).map(o => o.name);
check("file listing shows only its own folder", root.status === 200 && folders.every(f => f === OWN), folders);
const mine = await call("/storage/v1/object/list/client-files", { method: "POST", token: T, body: { prefix: OWN + "/", limit: 100 } });
const f = (mine.json || []).find(o => o.id);
check("CAN see files in its own folder (control)", !!f, short(mine));
if (f) {
  const s = await call(`/storage/v1/object/sign/client-files/${OWN}/` + encodeURIComponent(f.name), { method: "POST", token: T, body: { expiresIn: 60 } });
  const link = s.json && (s.json.signedURL || s.json.signedUrl);
  const got = link ? await fetch(URL_ + "/storage/v1" + link) : null;
  check("CAN open its own file through a signed link (control)", got && got.status === 200 && (await got.arrayBuffer()).byteLength > 0, short(s));
}
for (const h of HIDDEN) {
  for (const name of ["agreement.pdf", "sample.pdf"]) {
    const rs = await call(`/storage/v1/object/sign/client-files/${h}/${name}`, { method: "POST", token: T, body: { expiresIn: 60 } });
    check(`can't get a link to ${h}/${name}`, !(rs.json && (rs.json.signedURL || rs.json.signedUrl)), short(rs));
  }
  const ls = await call("/storage/v1/object/list/client-files", { method: "POST", token: T, body: { prefix: h + "/", limit: 10 } });
  check(`can't list the files of "${h}"`, Array.isArray(ls.json) && ls.json.length === 0, short(ls));
}
const up = await call(`/storage/v1/object/client-files/${OWN}/probe-upload.txt`, { method: "POST", token: T, body: "probe", raw: true, headers: { "Content-Type": "text/plain" } });
check("can't upload files", up.status >= 400, short(up));

await call("/auth/v1/logout", { method: "POST", token: T });
console.log(`\n${pass} passed, ${fail} failed, of ${pass + fail} checks`);
process.exit(fail ? 1 : 0);

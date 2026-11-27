// Client space: are the database rules actually keeping clients apart?
//
// Runs supabase.sql on a real Postgres (PGlite, in memory) with stand-ins
// for the parts of Supabase it leans on: the anon / authenticated roles,
// auth.users and auth.uid(), and the storage schema. Every check runs in
// its own transaction as one pretend person, and is rolled back after.
//
// Then it breaks the rules on purpose, three different ways, and expects
// the checks that guard each one to fail. A check that can't fail proves
// nothing.
//
//   npm run db

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(new URL("../supabase.sql", import.meta.url), "utf8");

const U = {
  client: "11111111-1111-1111-1111-111111111111", // linked to crude, confirmed
  other: "22222222-2222-2222-2222-222222222222",  // linked to other, confirmed
  team: "33333333-3333-3333-3333-333333333333",   // in team_members
  squat: "44444444-4444-4444-4444-444444444444",  // signed up with crude's email, never confirmed
  newbie: "55555555-5555-5555-5555-555555555555", // signed up, confirmed, linked to nothing yet
  late: "66666666-6666-6666-6666-666666666666",   // signed up, never opened the confirmation email
};

// what the team has shared, and the comments on it (seeded)
const I = {
  crude: "aaaaaaaa-0000-0000-0000-000000000001",
  other: "aaaaaaaa-0000-0000-0000-000000000002",
  teamNote: "bbbbbbbb-0000-0000-0000-000000000001",
  otherNote: "bbbbbbbb-0000-0000-0000-000000000002",
};

const STAND_INS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
    created_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
  grant select, update on auth.users to service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  -- storage, as Supabase ships it: RLS on, table-level grants to everyone,
  -- so the policies are the only thing deciding who sees a file
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end $$;
`;

const SEED = `
  insert into auth.users values
    ('${U.client}', 'client@crude.test', now()),
    ('${U.other}',  'someone@other.test', now()),
    ('${U.team}',   'team@hs.test', now()),
    ('${U.squat}',  'client@crude.test', null);
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    ('${U.newbie}', 'new@person.test', now(), '{"full_name": "New Person"}'),
    ('${U.late}',   'late@person.test', null, '{"full_name": "Late Person"}');
  insert into public.team_members values ('team@hs.test');
  insert into public.clients (id, name, emails, record) values
    ('crude', 'Crude', array['client@crude.test'], '{"price": 775}'),
    ('other', 'Other', array['someone@other.test'], '{"price": 5000}');
  insert into storage.buckets values ('elsewhere', 'elsewhere', false);
  insert into storage.objects (bucket_id, name) values
    ('client-files', 'crude/logo.png'),
    ('client-files', 'crude/fonts/lora.woff2'),
    ('client-files', 'other/secret.pdf'),
    ('client-files', 'loose.png'),
    ('elsewhere', 'crude/not-ours.png');
  insert into public.client_items (id, client_id, section, kind, title, url, added_by) values
    ('${I.crude}', 'crude', 'First build', 'link', 'Site preview', 'https://example.test', 'team@hs.test'),
    ('${I.other}', 'other', 'First build', 'link', 'Other preview', 'https://other.test', 'team@hs.test');
  insert into public.client_comments (id, client_id, section, author, author_name, from_team, body) values
    ('${I.teamNote}', 'crude', 'First build', 'team@hs.test', 'Horizon Symmetry', true, 'Here it is'),
    ('${I.otherNote}', 'other', 'First build', 'someone@other.test', 'Someone', false, 'a note only Other may read');
`;

async function fresh(sql) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(sql);
  await db.exec(sql); // pasting it twice must not break anything
  await db.exec(SEED);
  return db;
}

// run one statement as one person, inside a transaction that is thrown away
async function as(db, who, statement) {
  await db.exec("begin");
  try {
    if (who === "anon") await db.exec("set local role anon");
    else {
      await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${U[who]}'`);
    }
    // several statements in a row: all but the last run first, in the same transaction
    const list = Array.isArray(statement) ? statement : [statement];
    for (const st of list.slice(0, -1)) await db.query(st);
    const r = await db.query(list[list.length - 1]);
    return { rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("rollback");
  }
}

const CHECKS = [
  // ---- the clients table
  ["client reads their own space", "client", "select id from public.clients", r => ids(r) === "crude"],
  ["client can't read another client", "client", "select id from public.clients where id = 'other'", r => rowsIs(r, 0)],
  ["client saves their answers", "client", `update public.clients set state = '{"a":1}' where id = 'crude'`, r => r.affected === 1],
  ["client can't save into another client", "client", `update public.clients set state = '{"a":1}' where id = 'other'`, r => r.affected === 0 && !r.error],
  ["client can't change the record (the price)", "client", `update public.clients set record = '{"price":1}' where id = 'crude'`, denied],
  ["client can't change who is linked", "client", `update public.clients set emails = array['me@x.test'] where id = 'crude'`, denied],
  ["client can't add a client", "client", `insert into public.clients (id, name, record) values ('x', 'X', '{}')`, denied],
  ["client can't delete their space", "client", "delete from public.clients where id = 'crude'", denied],
  ["client can't read the team list", "client", "select * from public.team_members", denied],
  ["client is not team", "client", "select public.is_team() as t", r => r.rows?.[0]?.t === false],
  ["state over 200 KB is refused", "client", `update public.clients set state = jsonb_build_object('x', repeat(md5(random()::text), 8000)) where id = 'crude'`, r => /check constraint/.test(r.error || "")],
  ["team reads every space", "team", "select id from public.clients order by id", r => ids(r) === "crude,other"],
  ["team can't answer for a client", "team", `update public.clients set state = '{"a":1}' where id = 'crude'`, r => r.affected === 0 && !r.error],
  ["team is team", "team", "select public.is_team() as t", r => r.rows?.[0]?.t === true],
  ["unconfirmed signup with a client's email sees nothing", "squat", "select id from public.clients", r => rowsIs(r, 0)],
  ["logged-out visitor can't read spaces", "anon", "select id from public.clients", denied],
  ["logged-out visitor can't ask is_team", "anon", "select public.is_team()", denied],
  ["logged-out keep-awake ping answers", "anon", "select public.ping() as p", r => r.rows?.[0]?.p === 1],

  // ---- the studio's side: who is waiting, and letting them in
  ["team sees who is waiting, and only them", "team", "select email, name, confirmed from public.waiting_accounts() order by email", r => (r.rows || []).map(x => x.email + ":" + x.confirmed).join(",") === "late@person.test:false,new@person.test:true" && r.rows[1].name === "New Person"],
  ["team connects a waiting person to a space", "team", "select public.connect_account('crude', 'New@Person.test') as e", r => (r.rows?.[0]?.e || []).join(",") === "client@crude.test,new@person.test"],
  ["connecting twice does not double the email", "team", "select public.connect_account('crude', 'client@crude.test') as e", r => (r.rows?.[0]?.e || []).join(",") === "client@crude.test"],
  ["connecting to a space that does not exist says so", "team", "select public.connect_account('nope', 'new@person.test')", r => /no space called nope/.test(r.error || "")],
  ["connecting something that is not an email is refused", "team", "select public.connect_account('crude', 'not an email')", r => /not an email address/.test(r.error || "")],
  ["team creates a space for a waiting person", "team", `select public.create_space('fresh', 'Fresh Co', '{"id":"fresh"}', 'new@person.test') as id`, r => r.rows?.[0]?.id === "fresh"],
  ["a space can't be created over an existing one", "team", `select public.create_space('crude', 'X', '{"id":"crude"}', null)`, r => /duplicate key/.test(r.error || "")],
  ["team confirms an account that never got the email", "team", "select public.confirm_account('late@person.test') as ok", r => r.rows?.[0]?.ok === true],
  ["a waiting person sees no space", "newbie", "select id from public.clients", r => rowsIs(r, 0)],
  ["a waiting person can't see who else is waiting", "newbie", "select * from public.waiting_accounts()", r => rowsIs(r, 0)],
  ["a waiting person can't connect themselves", "newbie", "select public.connect_account('crude', 'new@person.test')", denied],
  ["a waiting person can't create a space", "newbie", `select public.create_space('mine', 'Mine', '{}', 'new@person.test')`, denied],
  ["a client can't see who is waiting", "client", "select * from public.waiting_accounts()", r => rowsIs(r, 0)],
  ["a client can't connect anyone", "client", "select public.connect_account('other', 'client@crude.test')", denied],
  ["a client can't create a space", "client", `select public.create_space('mine', 'Mine', '{}', 'client@crude.test')`, denied],
  ["a client can't confirm an account", "client", "select public.confirm_account('late@person.test')", denied],
  ["an unconfirmed signup can't confirm itself", "late", "select public.confirm_account('late@person.test')", denied],
  ["logged-out visitor can't ask who is waiting", "anon", "select * from public.waiting_accounts()", denied],
  ["logged-out visitor can't connect anyone", "anon", "select public.connect_account('crude', 'x@y.test')", denied],
  ["logged-out visitor can't create a space", "anon", `select public.create_space('mine', 'Mine', '{}', null)`, denied],
  ["logged-out visitor can't confirm an account", "anon", "select public.confirm_account('late@person.test')", denied],
  ["team removes a waiting sign-up", "team", "select public.remove_account('Late@Person.test') as ok", r => r.rows?.[0]?.ok === true],
  ["a removed sign-up is gone from the list", "team", ["select public.remove_account('late@person.test')", "select count(*) as listed from public.waiting_accounts() w where w.email = 'late@person.test'"], r => r.rows && +r.rows[0].listed === 0],
  ["team can't remove a connected client", "team", "select public.remove_account('client@crude.test')", r => /only someone waiting/.test(r.error || "")],
  ["team can't remove a team member", "team", "select public.remove_account('team@hs.test')", r => /only someone waiting/.test(r.error || "")],
  ["a client can't remove anyone", "client", "select public.remove_account('new@person.test')", denied],
  ["a waiting person can't remove anyone", "newbie", "select public.remove_account('late@person.test')", denied],
  ["logged-out visitor can't remove anyone", "anon", "select public.remove_account('new@person.test')", denied],

  // ---- the files
  ["client sees their own files", "client", "select name from storage.objects where bucket_id = 'client-files' order by name", r => names(r) === "crude/fonts/lora.woff2,crude/logo.png"],
  ["client can't see another client's files", "client", "select name from storage.objects where name like 'other/%'", r => rowsIs(r, 0)],
  ["client can't see files outside a client folder", "client", "select name from storage.objects where name = 'loose.png'", r => rowsIs(r, 0)],
  ["a crude/ folder in another bucket stays hidden", "client", "select name from storage.objects where bucket_id = 'elsewhere'", r => rowsIs(r, 0)],
  ["client can't upload", "client", "insert into storage.objects (bucket_id, name) values ('client-files', 'crude/new.png')", r => /row-level security/.test(r.error || "")],
  ["client can't delete a file", "client", "delete from storage.objects where name = 'crude/logo.png'", r => r.affected === 0 && !r.error],
  ["team sees every client's files", "team", "select name from storage.objects where bucket_id = 'client-files' and name like '%/%' order by name", r => names(r) === "crude/fonts/lora.woff2,crude/logo.png,other/secret.pdf"],
  ["unconfirmed signup sees no files", "squat", "select name from storage.objects", r => rowsIs(r, 0)],
  ["logged-out visitor sees no files", "anon", "select name from storage.objects", r => rowsIs(r, 0)],
  ["the bucket is private", "client", "select public from storage.buckets where id = 'client-files'", r => r.rows?.[0]?.public === false],
  ["team uploads into a client's folder", "team", "insert into storage.objects (bucket_id, name) values ('client-files', 'crude/shared/x1/brief.pdf')", r => r.affected === 1],
  ["team can't upload into a folder that is no client", "team", "insert into storage.objects (bucket_id, name) values ('client-files', 'nobody/x.pdf')", r => /row-level security/.test(r.error || "")],
  ["team can't upload outside a client folder", "team", "insert into storage.objects (bucket_id, name) values ('client-files', 'loose2.pdf')", r => /row-level security/.test(r.error || "")],
  ["team removes a file", "team", "delete from storage.objects where name = 'crude/logo.png'", r => r.affected === 1],
  ["a waiting person can't upload", "newbie", "insert into storage.objects (bucket_id, name) values ('client-files', 'crude/x.pdf')", r => /row-level security/.test(r.error || "")],

  // ---- what the team shares in the Files view, and the comments on it
  ["client reads what was shared with them", "client", "select title from public.client_items", r => !r.error && r.rows.map(x => x.title).join(",") === "Site preview"],
  ["client can't read another client's shared items", "client", "select title from public.client_items where client_id = 'other'", r => rowsIs(r, 0)],
  ["client can't add an item", "client", "insert into public.client_items (client_id, section, kind, title, url) values ('crude', 'X', 'link', 'Mine', 'https://x.test')", r => /row-level security/.test(r.error || "")],
  ["client can't remove an item", "client", `delete from public.client_items where id = '${I.crude}'`, r => r.affected === 0 && !r.error],
  ["team adds a link, signed as the team whatever it says", "team", "insert into public.client_items (client_id, section, kind, title, url, added_by) values ('crude', 'First build', 'link', 'Brand book', 'https://brand.test', 'someone@else.test') returning added_by", r => r.rows?.[0]?.added_by === "team@hs.test"],
  ["team adds a file inside the client's folder", "team", "insert into public.client_items (client_id, section, kind, title, path, file_name, size) values ('crude', 'First build', 'file', 'Logo', 'crude/shared/x1/logo.zip', 'Logo.zip', 1200)", r => r.affected === 1],
  ["a file can't point into another client's folder", "team", "insert into public.client_items (client_id, section, kind, title, path) values ('crude', 'X', 'file', 'Theirs', 'other/secret.pdf')", r => /check constraint/.test(r.error || "")],
  ["a link that is not http(s) is refused", "team", "insert into public.client_items (client_id, section, kind, title, url) values ('crude', 'X', 'link', 'Bad', 'javascript:alert(1)')", r => /check constraint/.test(r.error || "")],
  ["team removes an item", "team", `delete from public.client_items where id = '${I.crude}'`, r => r.affected === 1],
  ["unconfirmed signup sees nothing shared", "squat", "select title from public.client_items", r => rowsIs(r, 0)],
  ["logged-out visitor can't read shared items", "anon", "select title from public.client_items", denied],
  ["client comments under a heading, signed as themselves whatever they send", "client", `insert into public.client_comments (client_id, section, author, author_name, from_team, body) values ('crude', 'First build', 'team@hs.test', 'Horizon Symmetry', true, 'Can the logo be bigger?') returning author, from_team, author_name`, r => r.rows?.[0]?.author === "client@crude.test" && r.rows[0].from_team === false && r.rows[0].author_name === "client"],
  ["client can't comment into another client's space", "client", `insert into public.client_comments (client_id, section, body) values ('other', 'First build', 'hi')`, r => /row-level security/.test(r.error || "")],
  ["a long comment (paragraphs) is fine", "client", `insert into public.client_comments (client_id, section, body) values ('crude', 'First build', repeat('A paragraph of feedback. ', 300))`, r => r.affected === 1],
  ["a comment needs a heading", "client", `insert into public.client_comments (client_id, body) values ('crude', 'hi')`, r => /null value|not-null/.test(r.error || "")],
  ["removing an item keeps the comments under its heading", "team", [`delete from public.client_items where id = '${I.crude}'`, "select body from public.client_comments where client_id = 'crude'"], r => !r.error && r.rows.map(x => x.body).join(",") === "Here it is"],
  ["client reads only their own space's comments", "client", "select body from public.client_comments", r => !r.error && r.rows.map(x => x.body).join(",") === "Here it is"],
  ["team's reply is marked as the team", "team", `insert into public.client_comments (client_id, section, body) values ('crude', 'First build', 'Yes, done') returning from_team, author_name`, r => r.rows?.[0]?.from_team === true && r.rows[0].author_name === "Horizon Symmetry"],
  ["client can't delete the team's comment", "client", `delete from public.client_comments where id = '${I.teamNote}'`, r => r.affected === 0 && !r.error],
  ["client deletes their own comment", "client", [`insert into public.client_comments (client_id, section, body) values ('crude', 'First build', 'oops')`, "delete from public.client_comments where body = 'oops'"], r => r.affected === 1],
  ["unconfirmed signup can't comment", "squat", `insert into public.client_comments (client_id, section, body) values ('crude', 'First build', 'hi')`, r => /row-level security/.test(r.error || "")],
  ["logged-out visitor can't comment", "anon", `insert into public.client_comments (client_id, section, body) values ('crude', 'First build', 'hi')`, denied],
];

function ids(r) { return (r.rows || []).map(x => x.id).join(","); }
function names(r) { return (r.rows || []).map(x => x.name).join(","); }
function rowsIs(r, n) { return !r.error && r.rows.length === n; }
function denied(r) { return /permission denied/.test(r.error || ""); }

async function run(sql) {
  const db = await fresh(sql);
  const out = [];
  for (const [name, who, statement, ok] of CHECKS) {
    const r = await as(db, who, statement);
    out.push({ name, pass: !!ok(r), got: r.error || JSON.stringify(r.rows ?? r.affected).slice(0, 120) });
  }
  await db.close();
  return out;
}

// ---- the real rules
const real = await run(SQL);
let failed = 0;
for (const c of real) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? "pass" : "FAIL"}  ${c.name}${c.pass ? "" : `  (got ${c.got})`}`);
}
console.log(`\n${real.length - failed} passed, ${failed} failed, of ${CHECKS.length} checks`);

// ---- broken on purpose: each must trip the checks that guard it
function swap(sql, from, to) {
  if (sql.split(from).length !== 2) throw new Error(`sabotage text not found once: ${from.slice(0, 60)}`);
  return sql.replace(from, to);
}
const SABOTAGE = [
  {
    what: "anyone signed in can add to a client's files",
    sql: swap(SQL, `for insert to authenticated with check (public.is_team());`, `for insert to authenticated with check (true);`),
    mustFail: ["client can't add an item"],
  },
  {
    what: "shared items readable by every signed-in person",
    sql: swap(SQL, `for select to authenticated using (public.can_open(client_id));
drop policy if exists "team adds items"`, `for select to authenticated using (true);
drop policy if exists "team adds items"`),
    mustFail: ["client can't read another client's shared items", "unconfirmed signup sees nothing shared"],
  },
  {
    what: "a comment keeps whatever author the browser sends",
    sql: swap(SQL, `    new.author := me;
    new.from_team := public.is_team();`, ``),
    mustFail: ["client comments under a heading, signed as themselves whatever they send"],
  },
  {
    what: "the comment rule forgets whose space it is",
    sql: swap(SQL, `with check (public.can_open(client_id) and author = public.my_email());`, `with check (author = public.my_email());`),
    mustFail: ["client can't comment into another client's space"],
  },
  {
    what: "the upload rule forgets to check it is the team",
    sql: swap(SQL, `with check (bucket_id = 'client-files' and public.is_team()
    and (storage`, `with check (bucket_id = 'client-files'
    and (storage`),
    mustFail: ["client can't upload"],
  },
  {
    what: "every signed-in person can read every space",
    sql: swap(SQL, "using (public.my_email() = any (emails) or public.is_team());", "using (true);"),
    mustFail: ["client can't read another client", "unconfirmed signup with a client's email sees nothing"],
  },
  {
    what: "file rule lets anyone into any client folder",
    sql: swap(SQL, "using (bucket_id = 'client-files' and public.can_open((storage.foldername(name))[1]));", "using (bucket_id = 'client-files');"),
    mustFail: ["client can't see another client's files", "unconfirmed signup sees no files"],
  },
  {
    what: "file rule forgets which bucket it is about",
    sql: swap(SQL, "using (bucket_id = 'client-files' and public.can_open(", "using (public.can_open("),
    mustFail: ["a crude/ folder in another bucket stays hidden"],
  },
  {
    what: "connecting forgets to check it is the team",
    sql: swap(SQL, `if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  if who is null or lower`, `if who is null or lower`),
    mustFail: ["a waiting person can't connect themselves", "a client can't connect anyone"],
  },
  {
    what: "creating a space forgets to check it is the team",
    sql: swap(SQL, `if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  if rec is null`, `if rec is null`),
    mustFail: ["a waiting person can't create a space", "a client can't create a space"],
  },
  {
    what: "the waiting list forgets to check it is the team",
    sql: swap(SQL, `  where public.is_team()
    and u.email is not null`, `  where u.email is not null`),
    mustFail: ["a waiting person can't see who else is waiting", "a client can't see who is waiting"],
  },
  {
    what: "confirming an account forgets to check it is the team",
    sql: swap(SQL, `if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  update auth.users set email_confirmed_at`, `update auth.users set email_confirmed_at`),
    mustFail: ["a client can't confirm an account", "an unconfirmed signup can't confirm itself"],
  },
  {
    what: "removing forgets to check it is the team",
    sql: swap(SQL, `if not public.is_team() then raise exception 'permission denied: the studio only' using errcode = '42501'; end if;
  select u.id into target`, `select u.id into target`),
    mustFail: ["a client can't remove anyone", "a waiting person can't remove anyone"],
  },
  {
    what: "removing forgets that connected clients are off limits",
    sql: swap(SQL, `   where lower(u.email) = lower(trim(who))
     and not exists (select 1 from public.clients c where lower(u.email) = any (c.emails))
     and not exists (select 1 from public.team_members t where t.email = lower(u.email))
   limit 1;`, `   where lower(u.email) = lower(trim(who))
   limit 1;`),
    mustFail: ["team can't remove a connected client", "team can't remove a team member"],
  },
];

let sabotageOk = true;
for (const s of SABOTAGE) {
  const res = await run(s.sql);
  const tripped = res.filter(c => !c.pass).map(c => c.name);
  const missed = s.mustFail.filter(n => !tripped.includes(n));
  if (missed.length) sabotageOk = false;
  console.log(`${missed.length ? "FAIL" : "pass"}  sabotage caught: ${s.what}${missed.length ? `  (not caught by: ${missed.join("; ")})` : ""}`);
}

// ---- a project that ran the first version (comments on one item) keeps its comments
const FIRST = execFileSync("git", ["-C", fileURLToPath(new URL("../..", import.meta.url)), "show", "e32cd7c:portal-setup/supabase.sql"], { encoding: "utf8" });
{
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(FIRST);
  await db.exec(`insert into public.clients (id, name, emails, record) values ('ll', 'LL', array['x@ll.test'], '{}');
    insert into public.client_items (id, client_id, section, kind, title, url, added_by) values ('${I.crude}', 'll', 'First build', 'link', 'Site', 'https://x.test', 'team@hs.test');
    insert into public.client_comments (item_id, client_id, author, author_name, from_team, body) values ('${I.crude}', 'll', 'x@ll.test', 'Pablo', false, 'Love the hero');`);
  await db.exec(SQL);
  await db.exec(SQL);
  const r = await db.query("select section, item_id, body from public.client_comments");
  const kept = r.rows.length === 1 && r.rows[0].section === "First build" && r.rows[0].item_id === null && r.rows[0].body === "Love the hero";
  await db.exec(`delete from public.client_items where id = '${I.crude}'`);
  const after = await db.query("select count(*)::int n from public.client_comments");
  const survives = after.rows[0].n === 1;
  if (!kept || !survives) failed++;
  console.log(`${kept ? "pass" : "FAIL"}  upgrade: a comment written on an item moves under that item's heading${kept ? "" : `  (got ${JSON.stringify(r.rows)})`}`);
  console.log(`${survives ? "pass" : "FAIL"}  upgrade: removing that item afterwards keeps the comment`);
  await db.close();
}

process.exit(failed || !sabotageOk ? 1 : 0);

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

const SQL = readFileSync(new URL("../supabase.sql", import.meta.url), "utf8");

const U = {
  client: "11111111-1111-1111-1111-111111111111", // linked to crude, confirmed
  other: "22222222-2222-2222-2222-222222222222",  // linked to other, confirmed
  team: "33333333-3333-3333-3333-333333333333",   // in team_members
  squat: "44444444-4444-4444-4444-444444444444",  // signed up with crude's email, never confirmed
  newbie: "55555555-5555-5555-5555-555555555555", // signed up, confirmed, linked to nothing yet
  late: "66666666-6666-6666-6666-666666666666",   // signed up, never opened the confirmation email
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
    const r = await db.query(statement);
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
];

let sabotageOk = true;
for (const s of SABOTAGE) {
  const res = await run(s.sql);
  const tripped = res.filter(c => !c.pass).map(c => c.name);
  const missed = s.mustFail.filter(n => !tripped.includes(n));
  if (missed.length) sabotageOk = false;
  console.log(`${missed.length ? "FAIL" : "pass"}  sabotage caught: ${s.what}${missed.length ? `  (not caught by: ${missed.join("; ")})` : ""}`);
}

process.exit(failed || !sabotageOk ? 1 : 0);

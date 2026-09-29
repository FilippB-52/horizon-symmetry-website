// Turns a client record file (portal/data/<id>.js) into the SQL that puts
// it in the database, ready to paste into Supabase > SQL Editor.
//
//   node portal-setup/make-client-sql.mjs portal/data/crude.js
//   node portal-setup/make-client-sql.mjs portal/data/crude.js client@their.com other@their.com
//
// The emails are who may open that space. Leave them out to add the
// client with nobody linked yet (the team can still open it).
// Running it again for the same client updates the record and keeps the
// client's saved answers.

import fs from "fs";
import vm from "vm";

const [file, ...emails] = process.argv.slice(2);
if (!file) {
  console.error("usage: node portal-setup/make-client-sql.mjs portal/data/<id>.js [email ...]");
  process.exit(1);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
const rec = sandbox.window.HS_CLIENT;
if (!rec || !rec.id || !rec.name) {
  console.error(file + " does not set window.HS_CLIENT with an id and a name");
  process.exit(1);
}

const json = JSON.stringify(rec, null, 2);
if (json.includes("$rec$")) throw new Error("the record contains the SQL quote marker $rec$");
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const list = emails.map(e => e.trim().toLowerCase()).filter(Boolean);

process.stdout.write(`-- ${rec.name}: generated from ${file}
insert into public.clients (id, name, emails, record)
values (${lit(rec.id)}, ${lit(rec.name)}, array[${list.map(lit).join(", ")}]::text[], $rec$${json}$rec$::jsonb)
on conflict (id) do update
  set name = excluded.name,
      record = excluded.record${list.length ? ",\n      emails = excluded.emails" : ""};
`);

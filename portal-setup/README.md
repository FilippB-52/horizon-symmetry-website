# Client space login: connecting it

Built 28 Sep 2026, local only. The login works end to end in **test mode**
on `http://localhost:5173/portal/login` (pretend accounts, this browser only).
Connecting it to Supabase is what turns the pretend accounts into real ones.
Nothing in this folder is ever served by the site (`.vercelignore`).

## What is where

| | |
|---|---|
| `portal/login`, `signup`, `forgot`, `reset`, `confirm` | the login pages (`portal/*.html`, `js/portal-login.js`, `css/portal-login.css`) |
| `portal/space` | the client space, behind the login (`js/portal-gate.js` picks whose, then starts `js/portal.js`) |
| `js/portal-auth.js` | the only file that talks to Supabase. Test mode lives here too |
| `portal/config.js` | the Supabase URL and publishable key. Empty = not connected |
| `portal-setup/supabase.sql` | tables and access rules. Paste once |
| `portal-setup/make-client-sql.mjs` | turns `portal/data/<id>.js` into SQL that adds that client |
| `portal-setup/email-templates/` | the three account emails in the studio design. `node build.mjs` rewrites them |
| `portal-setup/tests/` | the checks: database rules (PGlite) and the browser flow (Playwright) |
| `portal/files/<id>/` | a client's files, local copy. Test mode shows these; live mode never does |
| `.github/workflows/keep-supabase-awake.yml` | stops the free project pausing after a week idle |

`portal/data/`, `portal/files/` and the example SQL hold a real client's details (Crude's
payments). **The GitHub repo is public**, so all three are in `.gitignore` and exist only on
this Mac and in Supabase. Back them up somewhere private if this Mac is the only copy.

## Connect it (about 15 minutes)

1. **Create the project.** supabase.com, sign in with the studio Gmail, New project,
   region in Europe. Save the database password in the password manager, never in chat.
2. **SQL Editor > New query**: paste `supabase.sql`, Run. Then paste
   `example-client-crude.sql`, Run (adds the example client, linked to nobody).
   `supabase.sql` also makes the private file bucket `client-files`.
   At project creation, leave "Enable Data API" on. "Automatically expose new tables" can stay
   off: `supabase.sql` grants exactly what the space needs (Supabase's default since 30 May 2026).
3. **Team.** Table Editor > `team_members`: one row per team member, the email each
   logs in with, lower case. The studio Gmail is already there.
4. **Authentication > URL Configuration.**
   Site URL: `http://localhost:5173` while testing, `https://horizonsymmetry.com` at launch.
   Redirect URLs: `http://localhost:5173/portal/**` and `https://horizonsymmetry.com/portal/**`.
5. **Authentication > Sign In / Providers > Email**: leave "Confirm email" on.
6. **Authentication > Emails > Templates**: for Confirm signup, Reset password and Invite user,
   paste the subject and the whole file from `portal-setup/email-templates/`
   (`confirm-signup.html`, `reset-password.html`, `invite.html`; subjects are printed by
   `node portal-setup/email-templates/build.mjs`). They send people to our own confirm page, so
   an email scanner opening the link can't use it up before the client clicks.
7. **Storage > client-files**: make a folder named after the client id (`crude`) and upload
   everything in `portal/files/crude/`, keeping the `fonts` folder. Files not uploaded show as
   "Uploading shortly" in the space; nothing falls back to a public address.
8. **Project Settings > API**: copy the Project URL and the publishable (anon) key into
   `portal/config.js`. Never the secret / service_role key.
9. Reload `localhost:5173/portal/login`. The test-mode box disappears. Sign up for real **with
   the studio Gmail**: until Resend is set up, Supabase only emails members of our own Supabase
   organisation. Check the confirm email looks right, then that the Crude files and fonts show
   (fonts come from the bucket, a different address, which the fake project in the tests can only
   imitate).

## Before a real client uses it

- **Email delivery.** Supabase's built-in mailer only sends to members of our Supabase
  organisation, a few per hour. Real clients need Authentication > SMTP set to Resend
  (free: 3,000 a month, 100 a day), sender `no-reply@horizonsymmetry.com`, after verifying
  the domain in Resend. The DNS records go in GoDaddy. Resend's records sit on a `send.`
  subdomain: do not touch the existing MX records, they carry our email.
- **Google sign-in (optional).** Authentication > Providers > Google, with a client ID and
  secret from Google Cloud Console (consent screen External, redirect URI
  `https://<project-ref>.supabase.co/auth/v1/callback`). Then `google: true` in
  `portal/config.js`. The Google screen will name the supabase.co address unless the paid
  custom domain add-on is bought.

## Everyday

- **Link a client to their space:** Table Editor > `clients` > `emails`, or
  `update public.clients set emails = array['client@their.com'] where id = 'crude';`
  They sign up with that email (or you use Authentication > Users > Invite user) and
  land straight in their space. Anyone whose email is not linked sees "Your account is ready".
- **Add a new client:** copy `portal/data/crude.js` to `portal/data/<id>.js`, fill it in, then
  `node portal-setup/make-client-sql.mjs portal/data/<id>.js client@their.com` and paste
  the output into the SQL Editor. Re-running it updates the record and keeps their answers.
  Their files go in Storage > client-files > `<id>/`, with the same names the record uses
  (`files/<id>/logo.png` in the record is `<id>/logo.png` in the bucket).
- **What they answered:** the `state` column of their row.

## How access works

The browser only ever receives rows the database rules allow. A client reads the row whose
`emails` contains their confirmed email, and can change only `state` (their answers), never
the record, the price or who is linked. The team reads every row and writes none. Files
follow the same rule: Supabase only signs a 12-hour link for a file in a folder the person
may open.

**Checks** (`portal-setup/tests`, `npm install` once, then `npm test` with the site running on
localhost:5173):
- `npm run db`: 28 checks on a real Postgres (PGlite) with stand-ins for Supabase's auth and
  storage, plus three deliberately broken versions of the rules that must each be caught.
- `npm run browser`: 19 checks in Chromium across test mode, the closed real site, and live mode
  against a made-up Supabase project answered by the test itself (nothing is sent anywhere),
  plus four broken versions of the code that must each be caught. It also proves the pinned
  supabase-js matches its hash.
Run both after any change to `supabase.sql` or `js/portal-auth.js`.

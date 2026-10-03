# Horizon Symmetry Main Website

The agency's own site. Venture: Horizon Symmetry. Permanent project, always updatable.
Repo `FilippB-52/horizon-symmetry-website`, deploys to Vercel on push to `main`.
Venture thread: `~/Obsidian/Sessions/Horizon Symmetry - Venture Handoff.md`
Folder thread: `~/Obsidian/Sessions/Horizon Symmetry Main Website Handoff.md`

Vanilla HTML/CSS/JS. No build step. Pages at root, `css/`, `js/`, `assets/`, sources in `_source/`.

## Traps specific to this repo

**Asset folder names must be lowercase.** macOS is case-insensitive so a wrong-case folder looks
fine locally, then Vercel serves it from Linux and every image 404s. Check case before pushing any
new asset folder. This has already shipped once (`assets/Komnata`).

**Never serve this with `python -m http.server`.** It answers a `Range:` request with 200 instead of
206, and Safari refuses to play video from a server that cannot do byte ranges. Chrome tolerates it,
so headless verification passes while Filipp sees a dead frame. Use a range-capable server.

**Cache-bust stamps are already in use.** Every CSS/JS URL carries `?v=<timestamp>`. Re-stamp after
editing those files or Filipp keeps seeing the old build. Live Vercel sends
`max-age=0, must-revalidate` plus an ETag, so stale copies on production come from his browser, not
the deploy.

**`js/work.js` has three switches at the top, lines 102-104.** They are off rather than deleted:
`SNAP = false` (deck rests only on whole cards), `BLOCKS = false` (coarse pixel reveal),
`GLIDE = 0.16` (share of distance closed per frame). GLIDE is the one number to tune if the scroll
feel is wrong, lower is heavier. Turning BLOCKS on re-gates `.card__motion` behind `.is-sharp`, which
is what once hid a working video for two turns.

**`work.js` and `handoff.js` must keep agreeing.** `work.js` samples the card's `<img>`, `handoff.js`
clones that same image as the ghost that flies into the case page. So a moving card layers a
`<video>` over the still rather than replacing it, and the still is recut from the clip's first frame.
Change one, check the other.

**ffmpeg is available here.** `npm i ffmpeg-static ffprobe-static` into the scratchpad gives real
arm64 binaries in about ten seconds. No Homebrew, no sudo. An older handoff claimed video work was
blocked; it was wrong.

**Vercel serves every file in the repo.** `CLAUDE.md` and `SEO/` were publicly readable until
2026-09-25. `.vercelignore` now keeps them off the deploy; any new internal file or folder goes in
there in the same commit, then check it 404s on the live URL.

## Client space (post-purchase portal, replaces the Notion client page)

Built 2026-09-26, login added 2026-09-28, private files and account emails 2026-09-29.
**Connected to Supabase on 2026-10-03** (project `hs-client-space`, West EU / Paris, free plan,
owned by the studio Gmail) and open on the live site. **Until Resend SMTP is set up, Supabase only
emails the studio**, so a client can't confirm a signup or reset a password themselves: create
their account in Authentication > Users > Add user, with auto confirm on. The branded email
templates also wait for SMTP (Supabase won't let you edit them before it). Call it "the client space", never "the Crude workspace": Crude is only the example
client. Connection steps, SQL and everyday tasks: `portal-setup/README.md`.

- **Entry:** `/portal/login` (also `signup`, `forgot`, `reset`, `confirm`), then `/portal/space`.
  `/portal` and the old `/portal/crude` redirect to the space. `js/portal-gate.js` decides whose
  space opens (one project: straight in; team: the list; none linked: "Your account is ready"),
  then starts `js/portal.js` with `window.HS_CLIENT` (the record) and `window.HS_VIEWER` (who).
- **`js/portal-auth.js` is the only file that knows about Supabase.** Three modes: `live` (config
  filled in), `test` (not connected AND on localhost: pretend accounts `client@test.hs` /
  `team@test.hs`, password `test1234`, records from `portal/data/*.js`), `off` (not connected on the
  real site: nobody gets in). supabase-js is pinned with an SRI hash; re-hash if the version changes.
- **Access is the database's job** (`portal-setup/supabase.sql`): a client reads the row whose
  `emails` holds their CONFIRMED email and may write only `state`. Team reads all, writes none, and
  `?preview` only works for the team. **Files** sit in the private bucket `client-files/<id>/`;
  in live mode `signFiles()` in `portal-auth.js` swaps every `files/<id>/...` in the record for a
  12-hour signed link, and a file not in the bucket comes back empty, never the public path.
- **Checks live in `portal-setup/tests/`** (`npm test`, needs the 5173 server): 28 database
  checks + 3 sabotage runs, 19 browser checks + 4 sabotage runs, live mode against a fake
  Supabase answered by the test. Run both after touching `supabase.sql` or `portal-auth.js`.
- **The GitHub repo is PUBLIC.** `portal/data/`, `portal/files/` and `portal-setup/example-client-*.sql`
  hold a real client's payments and files, so they are in `.gitignore` as well as `.vercelignore`
  and exist only on this Mac and in Supabase. Tracked files like this one are public on GitHub
  even though `.vercelignore` keeps them off the site.
- It is an app, not a page: the sidebar is the navigation and the main area shows ONE view at a
  time (`#home`, `#timeline`, `#questionnaire`, `#directions`, `#files`, `#payments`, `#calls`,
  `#messages`). Filipp rejected the first version (one long scroll, 26 Sep) as messy: keep it to
  one view, and hide what is not relevant yet (Directions only appears once it opens).
- No client logo anywhere: the client may have ordered the logo. Their name is set in type.
- `?preview` adds a stage switcher to the bottom of the sidebar that moves "today" through the
  project (Just paid, Direction review, Mid-production, Delivered, Complete). Status, progress and
  what is ready are all derived from dates in the record, which is how the real thing will behave.
- Messages and bookings still go by mailto / Cal.com: those spots are commented `BACKEND:` in
  `js/portal.js`. Questionnaire answers and the direction pick now save to the client's row.
- Account emails (confirm, reset, invite) are in `portal-setup/email-templates/`, generated by
  `build.mjs` in the auto-reply's design. The mark is linked from `assets/logo-mark.png` on the
  live site: moving or renaming that file breaks it in every email already sent.
- `vercel.json` sends `noindex` + `no-store` for `/portal/*`. Deliberately NOT in robots.txt,
  which would advertise the path.

## Known open items
- `alley.html` and `neirion.html` exist in the repo, unlinked from the deck. Restoring them is markup.
- KOMNATA slots 08 and 13 need real assets, slot 01 is marked "video" and none exists.

## Working here
Push each finished change to `main` immediately, then verify the live URL. Not done until it is live.

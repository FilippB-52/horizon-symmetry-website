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

## Known open items
- `arcut-04.mp4` is labelled "the logotype resolving, in motion" in `arcut.html`. It is a colour
  palette board. Still unfixed.
- `alley.html` and `neirion.html` exist in the repo, unlinked from the deck. Restoring them is markup.
- KOMNATA slots 08 and 13 need real assets, slot 01 is marked "video" and none exists.

## Working here
Push each finished change to `main` immediately, then verify the live URL. Not done until it is live.

# legacy/

Code that left the live paths but is kept whole (zero-loss). Nothing in `src/` imports from here; the tests still run.

- `recommend.mjs` + `recommend.test.js` — the REC route that opened a GitHub pull request from the Worker (needed `GITHUB_TOKEN`).
  Retired 2026-10-30 in favour of `lib/submissions.mjs`: REC rows go to D1 and the librarian routine opens the PR.
- `range.mjs` — byte-range answers for `/media/*`. Retired 2026-10-31. The Worker no longer serves tape files. `tests/range.test.js` still runs it.
- `ingest.mjs`, `batch.mjs` — the local MP4 pipeline (download, transcode, posters, `media_source`). Retired 2026-10-31. Do not run them against the shelf: the validator rejects `media`, `poster`, `media_bytes`, and `media_source`.
- `verify-embeds.mjs` — the old oEmbed walk over `source` / `embedId`. Retired 2026-10-31 in favour of `npm run check-embeds` (`scripts/check-embeds.mjs`), which reads `play`.
- `ruffle-player.js` — Ruffle playback for a licensed `.swf`. Retired 2026-10-31. The deck does not load it.
- `hosted-player.js` — `<video src="/media/...">` and the Vimeo / archive.org iframe that did not use a player API. Retired 2026-10-31. Archive tapes now go through `playArchive` in `public/app.js`.

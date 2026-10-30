# Decisions — plebflix-tv

Newest first. One entry per decision: date · who · decision · why · source.

## 2026-10-30 · Niko · LIVE is one broadcast for everyone; Skip = CONTINUOUS, REW/FWD = TIMESHIFT; PAUSE and the glass toggle
- **Decision:** the live view is the same tape at the same second for every viewer of a channel. Skip/Back, a schedule
  row or a search hit put the deck on CONTINUOUS (the programme plays on from the tape you picked); REW, FWD and the
  scrubber on TIMESHIFT ±mm:ss (the broadcast, shifted). The PAUSE key pressed again plays on; a click on the glass
  pauses and the next click plays on. The lamp reads PAUSE −mm:ss while held.
- **Why:** Niko: *"can we make it so that the live view is always constant and always the same for anyone browsing? this
  way you could ask a friend to tune in for the exact same show. skipping would put it to continuous mode, ff or bb would
  put it to timeshifted. … double pressing pause should release it. same with screen clicking."*
- **Source:** Niko in chat, 2026-10-30. `public/app.js` `shiftKind`, `setTimeshift`, `nudge`, `seekTo`, `wire()`.

## 2026-10-30 · Niko · Content lives in plain data files under `channels/`; Page edits only those and `media/`
- **Decision:** the shelves (`channels/international.json`, `channels/suomi.json`), `channels/categories.json` and the new
  `channels/schedule.json` are the whole content surface. The format, the required fields, how a tape slots into a
  channel's day and the gate (`npm run validate`, run by CI on every PR) are in `LIBRARIAN.md` §0. The directory stays
  `channels/` rather than `data/`: it is already plain data, served as-is at `/channels/*.json`, and every tool, test and
  CI step points there (Niko's `data/catalog.json` was "for example").
- **Why:** Niko: *"Another assistant (Page) adds content to this repo through daily PRs. Please keep the catalog and
  channel schedule in plain data files … separate from the player code. Document the format in LIBRARIAN.md … Page will
  only edit those data files and media/, and will never touch the app code."*
- **Source:** Niko in chat, 2026-10-30. `scripts/validate.mjs`, `lib/schema.mjs` `validateSchedule` / `validateCategories`.

## 2026-10-30 · Claude (session) · A tape airs from the UTC day after it was filed; open tabs re-read the shelf after a deploy
- **Decision:** every new tape carries `added: YYYY-MM-DD` (stamped by `ingest.mjs` / `batch.mjs`); `liveItems` keeps it
  off the programme until the next UTC day. `channels/index.json` carries a `build` stamp (hash of the shelves,
  `categories.json`, `schedule.json` and `schedule.js`); a tab polls it every five minutes while visible and re-reads the
  data when it changed. The deck waits up to 4 s for the vote snapshot, retries a failed fetch every 30 s and accepts a
  late one (the lineup rebuilds once). The loaded-tape key now names the tape, not only its slot.
- **Why:** "the same show for anyone browsing" needs identical inputs on every device: a deploy that changed today's
  programme, a stats request that was slower than the old 1.5 s cut-off, or a vote snapshot that never arrived each put
  one viewer on a lineup of their own until they reloaded.
- **Source:** first-principles pass on what the lineup is a function of (shelf, schedule, generator, UTC day, frozen
  stats, clock). `public/schedule.js` `liveItems`, `public/app.js` `loadCatalog` / `pollBuild` / `ensureStats`, `scripts/build.mjs`.

## 2026-10-30 · Claude (session) · Schedule definitions per channel in `channels/schedule.json`; defaults keep today's behaviour
- **Decision:** a channel block may set `order` (`seeded` = weighted deterministic draw per day, `catalog` = file order,
  the same every day), `hold_out_hours`, `ident_seconds` and fixed UTC `slots` (`{ at: "HH:MM", tape }`). A category
  channel inherits its TV's block. The shipped file has only defaults, so no lineup changed with this deploy.
- **Why:** "a strict daily schedule" and "a schedule definition per channel" need a place for programming decisions that
  is data, not code; UTC times rather than a zone name so every device computes the same second (a stale tz database
  would otherwise split viewers). Which slots to set (e.g. B5mies at 19:00 UTC on Suomi) is Niko's programming call.
- **Source:** `public/schedule.js` `resolveDefinition` / `buildBroadcast`; tests "a fixed slot lands at its second",
  "order: catalog".

## 2026-10-30 · Claude (session) · The schedule window is the day's programme guide, readable during STOP
- **Decision:** the window lists every tape of the UTC day at local times with a date divider at local midnight; the
  inverse row is ON AIR on the shared clock (clicking it = GO LIVE), an amber-outlined row is where this viewer is when
  off the broadcast. Rows are built once per channel and day; ticks move markers only. The well scrolls and follows the
  row that matters unless the viewer scrolled it in the last 20 s. During STOP it stays visible (before: "NO SIGNAL —
  PRESS PLAY").
- **Why:** Niko: *"a strict daily schedule that will be visible as the playlist."* A guide that only showed 16 rows from
  the viewer's own position could not tell a friend when to tune in.
- **Source:** `public/app.js` `renderSchedule` / `followRow`, `public/styles/tokens.css` `.sched__row--here`, `.sched__day`.

## 2026-10-30 · Claude (session) · A refused embed in LIVE holds a NO SIGNAL card; the two "top tape" boot requests are gone
- **Decision:** `advance("error")` in LIVE shows NO SIGNAL and waits for the shared clock to cross into the next tape
  instead of jumping ahead (which made the deck a private timeshift). Boot no longer fetches tomorrow's stats for the
  retired intro's "most popular tape" jump; `topTapeId` falls back to the curated list and the code stays in place.
- **Why:** both were ways a viewer silently left the shared broadcast; the second also cost two cache-missing D1 scans
  per colo every ten minutes for a feature nothing calls.
- **Source:** `public/app.js` `advance`, `boot`.

## 2026-10-30 · Claude (session) · Scripts and styles carry a content hash in their URL; `_headers` makes them immutable
- **Decision:** `scripts/build.mjs` rewrites every `<script src>`/`<link href>` in the built shell (and app.js's import of
  schedule.js) to `?v=<sha256[:10]>`, and `_headers` caches those files for a year. `index.html` stays `max-age=0`.
- **Why:** with `app.js` cached for five minutes, a deploy that changes the HTML and the script together (the one-field
  REC card did) left returning browsers running the old script against the new page for up to five minutes: the REC
  dialog threw on a missing element. Seen in the local browser check before this fix.
- **Source:** this session's browser verification against `wrangler dev`.

## 2026-10-30 · Niko · REC is one field: drop a link, the librarian works out the rest
- **Decision:** the REC card asks for the video link only. No channel, title, year, signals, name or note. A pasted link
  files itself; the deck sends the TV that is on as the channel. The librarian takes title, year, duration and uploader
  from the link (`yt-dlp -j`; `scripts/ingest.mjs` fills them in when `--title`/`--year` are omitted) and judges the signals.
- **Why:** Niko: *"maybe we should make it easy and you just drop a link and we don't ask them to fill anything because we
  can figure all that out ourselves right?"* The server already stored every other field as optional.
- **Source:** Niko in chat, 2026-10-30. `public/index.html` REC dialog, `public/app.js` `wireRec`, `lib/submissions.mjs`.

## 2026-10-30 · Niko · A click on the TV screen pauses; the next click plays on
- **Decision:** the glass (`#screen`) toggles pause/play. Buttons on the OSD (LIVE lamp, "Tap for sound") keep their own job.
  From STOP a click plays live.
- **Why:** Niko: *"a click on the tv screen should pause the play."*
- **Source:** Niko in chat, 2026-10-30. `public/app.js` `wire()`.

## 2026-10-30 · Claude (session) · The live clock is anchored to UTC midnight
- **Decision:** `liveSeconds` counts seconds since 00:00 UTC of the current day, wrapped onto the day's lineup (which is
  built to cover at least a day). Before, it was epoch seconds modulo the lineup length.
- **Why:** the old anchor entered each day's lineup at an arbitrary phase and jump-cut twice a day (midnight and the
  modulo wrap). Now the lineup starts at midnight and the only cut is midnight. Also a one-time position change at deploy.
- **Source:** reviewer finding on `public/schedule.js`; test "the live clock starts the day's lineup at 00:00 UTC".

## 2026-10-30 · Claude (session) · A tape that ends early holds the frame; LIVE never slides into TIMESHIFT by itself
- **Decision:** `advance("end")` in LIVE mode covers the last frame with the poster and waits for the shared clock to cross
  the boundary. LOOP restarts the tape and SHUFFLE draws the next one right there; only a plain timeshift skips ahead.
- **Why:** durations are whole seconds, so about half the files end a fraction early; the old code jumped to the next tape
  and switched the deck to TIMESHIFT, after which viewers drifted apart by a second per tape until someone pressed LIVE.
- **Source:** reviewer finding on `public/app.js` `advance`; the keyboard/seek state fixes (`nudge` marks a user seek) ride along.

## 2026-10-30 · Claude (session) · `/api/stats` answers only a bounded window and pays the play rate limit on a miss
- **Decision:** `channel` must be an own property of the catalog map; `day` must be a real date between seven days ago and
  tomorrow; the edge cache key carries `frozen`/`live`; a cache miss spends one `PLAY_RL` token. Impressions spend one
  `PLAY_RL` token per row, not per request.
- **Why:** any `day` was a cache miss that scanned both vote tables (D1 bills rows read; the free tier locks the database
  for the day when exhausted), `channel=constructor` passed the lookup, and a 20-row impression batch cost one token.
- **Source:** reviewer findings on `lib/votes.mjs`; tests in `tests/votes.test.js`.

## 2026-10-30 · Claude (session) · `lib/recommend.mjs` moved to `legacy/`; `GITHUB_REPO` binding dropped
- **Decision:** the Worker-side GitHub pull-request route and its test live in `legacy/` with their imports repointed. The
  Worker has no GitHub bindings; `npm run curate -- --pr` reads `GITHUB_REPO`/`GITHUB_TOKEN` from the shell.
- **Why:** nothing in `src/` imported it since REC moved to D1, and the README still described the old flow. Zero-loss:
  moved, not deleted; the test still runs.
- **Source:** `src/worker.ts` routes `/api/recommend` to `handleSubmit`; `legacy/README.md`.

## 2026-10-30 · Claude (session) · Votes are capped per address, not only per viewer id
- **Decision:** a vote row stores a salted SHA-256 of the voter's address (IPv6 reduced to its /64); one address casts at most
  5 votes per tape (`IP_ITEM_CAP`), whatever viewer ids it invents. Over the cap answers 409 like a repeat vote. Migration
  `0003_votes_ip.sql`. Optional secret `IP_SALT`; without it a fixed salt is used (same hashes as the submissions table already had).
- **Why:** the only dedupe was the client-chosen `viewerId`, so a loop of fresh UUIDs could flag a tape for removal (12 down-votes)
  in under a minute. A per-address cap raises the cost to many networks. 5 keeps a shared household or office voting; /64 stops
  one device's rotating IPv6 suffixes. Turnstile would be stronger but needs a dashboard key and a dependency (not now).
- **Source:** audit of `lib/votes.mjs` (`handleVote`, `d1Store.addVote`); tests in `tests/votes.test.js`, `tests/ip.test.js`.

## 2026-10-30 · Claude (session) · Security headers and a script-only CSP in `_headers`
- **Decision:** every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  a `Permissions-Policy` that denies camera/microphone/geolocation/payment, and a `Content-Security-Policy` limited to
  `script-src` (self, blob:, www.youtube.com, s.ytimg.com, unpkg.com for Ruffle, `wasm-unsafe-eval`), `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`. No `default-src`, `style-src`, `img-src`, `frame-src`: those stay open.
- **Why:** the script directive is what turns an injected tag into a no-op; the open directives are what the player needs
  (inline style attributes, YouTube/Vimeo/archive.org frames, poster images from i.ytimg.com). A full CSP would need
  `'unsafe-inline'` styles and a maintained host list for small gain. Verified in Chrome against `wrangler dev`.
- **Source:** audit; `public/_headers`.

## 2026-10-30 · Claude (session) · `workers_dev` off
- **Decision:** `wrangler.jsonc` sets `workers_dev: false`. The site answers only on plebflix.com and www.plebflix.com.
- **Why:** the workers.dev copy was a second public origin for the same content (duplicate indexing, a host nobody watches).
- **Source:** audit; `wrangler.jsonc`.

## 2026-10-30 · Claude (session) · Media is recovered from the live site, not from the Cursor box
- **Decision:** `media/` (264 tapes, 264 posters, 1.85 GiB, gitignored) is mirrored onto the deploying machine from
  `https://plebflix.com/media/...`. The Cursor box `/workspace/deploy/plebflix-tv` is no longer the deploy machine.
- **Why:** every catalog media file answered 200 on the live site (528/528 checked); the box and its connectors are not
  reachable from this Mac. Static-asset deploys re-send the whole manifest, so a deploy without `media/` would drop every tape.
- **Source:** this session; `scripts/ingest.mjs --check` after the mirror.

## 2026-10-30 · Claude (session) · wrangler.jsonc pins `account_id` f7b1f5882ab68d7dfd785ad6942b2db2
- **Decision:** the owning account ("PC account") is written into `wrangler.jsonc` so `wrangler deploy` can never land on
  the Mac's OAuth default (`omnifinn`, 141fee…), which does not hold the zone.
- **Why:** bask-os WORK-STATE records a mistaken upload to the wrong account on 2026-10-27. Pinning removes the hazard.
- **Source:** `npx wrangler whoami` (only 141fee… visible), `wrangler deployments list` → "Worker does not exist".

## 2026-10-30 · Claude (session) · Deploy path = push main to GitHub, then `wrangler deploy` from a machine holding `media/`
- **Decision:** the git-to-live path is: CI (`validate.yml`) green on main → `npx wrangler deploy` with credentials for
  the owning account. A GitHub Action that deploys is deferred until the media has a home the Action can fetch from.
- **Why:** the media is not in git by design (1.85 GiB, 25 MiB/file). An Action deploy today would publish a site with no tapes.
  Candidate homes: GitHub Releases (free), R2 (free tier, needs a payment method on the account → Niko's call).
- **Source:** README "Deploy", LIBRARIAN.md §4, `.gitignore`.

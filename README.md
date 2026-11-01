# Plebflix — real human slop

A 24/7 living-room broadcast of classic internet videos. Two channels share one clock: **Suomi** (Finnish net culture, Flash, and the clips that escaped the message boards) and **International** (the early viral shelf). Everyone watching a channel is on the same tape at the same second. The set is a CRT on a VHS cabinet, and the deck buttons behave like a deck.

What counts as a classic is in `CLASSIC.md`: at least ten years old, and at least three of the five signals. Every card has an `original_url`. The glass shows it as SOURCE. Playback stays in the tube: each tape has an ordered list of sources, the YouTube IFrame Player API on `youtube-nocookie.com`, a file streamed from archive.org, or a still from its public host. The site does not host the video and does not send a viewer off the site to watch it.

`LIBRARIAN.md` is the daily routine: where votes and submissions live, how to vet a tape, how to file one, and how to deploy with `scripts/deploy.mjs`. `sources.json` lists the shelves a suggestion may cite, including the Wayback Machine and archive.org. `RESOURCES.md` prints them. `/credits` lists every tape and its uploader. `/takedown` is how a rights holder asks for a tape to come off (`takedown@plebflix.com`).

## Watch it locally

```bash
npm install
npm run dev
```

`npm run dev` builds, then runs `wrangler dev`. The set is at <http://localhost:8787>.

PLAY, PAUSE, REW, FWD, STOP, and REC sit on the deck. CH+ / CH− and the tapes on the shelf switch between Suomi and International. LIVE is one broadcast: everyone on a channel sees the same tape at the same second, so a friend can tune in to the same show. PAUSE holds this browser (press it again, click the glass again, or Space, to play on). REW and FWD put this browser on TIMESHIFT (the broadcast, shifted). Skip, Back, a schedule row or a search hit put it on CONTINUOUS (the programme plays on from the tape you picked). PLAY, GO LIVE and the LIVE lamp return to the broadcast. STOP is snow and a test card; the programme guide stays readable.

## Build output

`npm run build` writes two things and nothing else that deploy needs:

- `dist/worker.js` — one ES module, the Worker script
- `dist/assets/` — the static site, including `channels/` and `RESOURCES.md`

`wrangler.jsonc` points `main` at `dist/worker.js` and the assets binding at `dist/assets/`. A Wrangler deploy and a Cloudflare API upload use those same paths. The script is module syntax. Compatibility date is `2026-10-29`.

## Share cards

`share.config.json` is the one place for share cards, favicons, and theme-color tags. `lib/share-head.mjs` writes the `<!-- share:begin/end -->` block in `index.html` and the `/suomi` page from it. International and Suomi share the v9 Boxing Cats card. The tab icon follows the deck: live, paused, shuffle, and loop live under `public/favicons/<state>/`, and `public/favicons/favicon-state.js` swaps them. Suomi keeps its own URL, language, and theme color. Swap the files in `public/`, bump `version` so X, WhatsApp, and iMessage refetch, then build and deploy. Edit the config, not the generated tags.

## Deploy

There is no GitHub Action that deploys. A static-asset deploy publishes exactly the files in `dist/assets`. Deploy from a machine with a credential for the Cloudflare account pinned in `wrangler.jsonc` (`account_id`, the account that owns plebflix.com). Push `main` to GitHub first; CI (`validate.yml`) is the gate. `prepare` refuses if the manifest contains `/media/`.

```bash
set -a; source ~/.config/cloudflare/plebflix-tv.env; set +a   # CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm ci && npm run build
npx wrangler d1 migrations apply plebflix-tv --remote          # new migrations first; the code expects the columns
npx wrangler deploy
node scripts/deploy.mjs verify
```

Optional secret: `npx wrangler secret put IP_SALT` (any long random string) salts the stored address hashes on votes and submissions. After the embed-only deploy, purge `https://plebflix.com/media/*` from the Cloudflare cache so old tape files stop being served from the edge.

First-time setup on a fresh account, for the record:

```bash
npm ci
npm run build
npx wrangler login
npx wrangler d1 create plebflix-tv
```

`npx wrangler d1 create plebflix-tv` prints a `database_id`. Paste that UUID onto the `d1_databases` entry in `wrangler.jsonc`. The database name stays `plebflix-tv`. The binding stays `DB`. `migrations_dir` is `migrations`: `0001_votes.sql` (tables `votes` and `impressions`), `0002_submissions.sql` (REC submissions), `0003_votes_ip.sql` (address hash on votes).

```bash
npx wrangler d1 migrations apply plebflix-tv --remote
npx wrangler deploy
```

`npx wrangler deploy` publishes Worker `plebflix-tv` from `dist/worker.js` and static files from `dist/assets/`. Custom domains are already in `wrangler.jsonc`: `plebflix.com` and `www.plebflix.com`, both with `custom_domain: true`. They attach on deploy when those hostnames are in a zone on the same account.

| Name | Kind |
| --- | --- |
| `plebflix-tv` | Worker name. |
| `dist/worker.js` | The script `main` points at. |
| `dist/assets/` | Assets directory. Binding `ASSETS`. |
| `plebflix-tv` | D1 database name. Binding `DB`. |
| `migrations/*.sql` | Apply before votes and REC will stick. |
| `IP_SALT` | Optional secret. Salts the address hashes stored on votes and submissions. |
| `GITHUB_REPO`, `GITHUB_TOKEN` | Shell variables for `npm run curate -- --pr` only (repo defaults to `omnifinn/plebflix-tv`). The Worker never talks to GitHub and has no such bindings. |
| `RATE_LIMIT` | Optional KV namespace. Without it, the per-isolate limiter stays in memory; the Rate Limiting bindings (`REC_RL`, `VOTE_RL`, `PLAY_RL`) count at the edge either way. |
| `plebflix.com`, `www.plebflix.com` | Custom domains in `wrangler.jsonc`. |

For local play, apply the same migration to the local database and start the set:

```bash
npx wrangler d1 migrations apply plebflix-tv --local
npm run dev
```

`remote` is `false` on the D1 binding, so `wrangler dev` uses that local database. If `DB` is missing at runtime, vote routes return HTTP 503: “The tape deck has no vote shelf. Create the D1 database plebflix-tv, bind it as DB, and apply migrations.” and REC returns 503 “The tape shelf is offline.”

`LIBRARIAN.md` is the daily routine (vet REC rows in D1, ingest, deploy). `scripts/deploy.mjs prepare|upload` is the older token-less path through a Cloudflare connector; `scripts/deploy.mjs verify` still smoke-checks the live site after any deploy.

## Worker configuration

The Worker name is `plebflix-tv`. Custom domains on the existing zone: `plebflix.com` and `www.plebflix.com`.

| Binding | What it is |
| --- | --- |
| `ASSETS` | Static assets from `dist/assets`. `/api/*` runs the Worker first. |
| `REC_RL`, `VOTE_RL`, `PLAY_RL` | Rate Limiting bindings (free): per address, per Cloudflare location, per minute. |
| `RATE_LIMIT` | Optional KV. Without it, the per-isolate limiter lives in memory. REC, votes, and play counts use different key prefixes. |
| `DB` | D1 database. The name is `plebflix-tv`. The binding is `DB`. Migrations live in `migrations/`. |
| `IP_SALT` | Optional secret. Without it the address hashes use a fixed salt. |

`POST /api/recommend` files a suggestion into the D1 `submissions` table (status `pending`). Nothing reaches GitHub from the Worker; the librarian routine vets the row and opens the pull request. Every API response also carries the `_headers` security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and a `Content-Security-Policy` that allows scripts from this origin and YouTube's IFrame API, and frames from YouTube and archive.org).

## Votes

The remote under the channel keys is two thumbs. They vote on the tape that is on, including after a timeshift. A station ident is not a tape. The OSD flashes `UP ▲`, `DOWN ▼`, `ALREADY VOTED`, `NOT A TAPE`, or `VOTE FAILED`.

One vote per tape per browser. The id is `localStorage` key `plebflix-viewer` (a UUID). The choice is remembered in `plebflix-votes`. The Worker also rate-limits by address (`VOTE_RL`: 30 a minute; `PLAY_RL`: 30 a minute, each up to 20 plays), and caps one address at 5 votes per tape whatever viewer ids it invents (IPv6 counts as its /64). The address itself is not stored: votes and submissions keep a salted SHA-256 of it (`IP_SALT`). Creating the D1 database `plebflix-tv` and applying `migrations/0001_votes.sql` is in [Deploy](#deploy).

| Route | |
| --- | --- |
| `POST /api/vote` | `{ itemId, channel, vote: "up" or "down", viewerId }`. A second vote on the same tape returns 409 `ALREADY VOTED`. |
| `POST /api/impression` | `{ itemId, channel, viewerId }`. The set sends this once per tape per viewer per UTC day, when the tape actually starts. |
| `GET /api/stats?channel=suomi&day=YYYY-MM-DD` | `{ items: { [id]: { up, down, net, wilson, impressions } } }`. Only rows with `created_at` before that UTC midnight. `day` may be any date from seven days ago to tomorrow (anything else is 400: every other day would be an uncached table scan). `wilson` is the lower bound of the Wilson score interval at z = 1.96. `net` is up minus down. |

The day’s lineup uses that snapshot, so votes cast today change tomorrow’s draw, and every viewer who received the snapshot is on the same tape.

## The day’s lineup

The broadcast is one UTC day, built from the channel, the date, the stats from before midnight and the channel's block in `channels/schedule.json` (`order` seeded or catalog, `hold_out_hours`, `ident_seconds`, fixed UTC `slots`; format in `LIBRARIAN.md`). With the defaults a seeded shuffle draws clips by weight, then holds each clip out for six hours. A short shelf cannot fill that window, so the deck falls back to the least-recently aired quarter and keeps going. An eight-second station ident airs between clips. It is drawn on the glass. It is not an embed. A fixed slot lands at its second: the gap before it is filled with tapes that fit, then a longer ident.

A tape with `added: YYYY-MM-DD` joins the programme from the next UTC day. The set waits up to four seconds for stats and keeps retrying a failed fetch every 30 s; a late reply rebuilds the lineup once so this viewer joins everyone else. Open tabs poll `channels/index.json` every five minutes and re-read the shelves when its `build` stamp changed, so a deploy does not leave old tabs on an old programme.

The schedule window is the day's programme guide: every tape of the UTC day at local wall-clock times, the inverse row ON AIR, an outlined row where this viewer is when off the broadcast. Clicking the ON AIR row joins the broadcast; any other row plays on from there (CONTINUOUS).

Under eight votes a tape weighs about 1, a little more when it has been shown fewer than two times, plus a small bump for a year before 2005 and a smaller one before 2010. At eight votes or more the weight is `0.25 + wilson × 1.9`, plus that same bump. A poor score airs less often. It is not banned.

## Curate

`npm run curate` reads the stats and prints a report. A tape is flagged to drop when it has at least 12 votes and a Wilson lower bound under 0.32. Calibration tapes stay on the shelf: B5mies, Kahen kilon siika, Ismo ja Seppo pyöräilee, Numa Numa, and Leeroy Jenkins. A channel is not taken under 25 playable tapes. The rest of the report lists the highest-scoring tapes and groups them by decade, creator, tag, and signal, which is the list of what to go find more of.

```bash
npm run curate
npm run curate -- --url http://127.0.0.1:8787
npm run curate -- --stats path/to/stats.json
npm run curate -- --pr
```

The stats file is `{ "suomi": { "b5mies": { "up": 1, "down": 0, "impressions": 4 } }, "international": {} }`. Without `--url` or `--stats`, the script tries the local set and then the local D1 sqlite under `.wrangler/`. If neither answers, the report says so and flags nothing.

`--pr` needs `GITHUB_TOKEN` (and `GITHUB_REPO`, which defaults to `omnifinn/plebflix-tv`). Without the token it prints the report and does not open a pull request. With the token, and with at least one drop, it opens a pull request against the default branch that removes those tapes and regenerates `RESOURCES.md`.

## Playback

Every tape has `play`, an ordered list of sources (`public/play.js`, `public/app.js`). YouTube uses the IFrame Player API on `youtube-nocookie.com`: autoplay, muted until a tap, seeked to the scheduled offset, so LIVE is the same programme for everyone. An archive.org source streams into the deck's own `<video>`, so seek, pause and sound work the same way. A still holds its slot. When a source refuses (YouTube errors 2, 5, 100, 101, 150, 153, a Vimeo player that does not start, or a stream that fails) the next source takes the same slot. YouTube stays first on every tape that has it, on `youtube-nocookie.com` then `www.youtube.com`. No PLAYING within 6 seconds counts as a refusal when another source is left. If every source fails the tape shows NO SIGNAL for its slot and `npm run verify-all-play` counts it as a failure: the deck does not skip. `npm run smoke` checks what is on air now.

The old download-and-transcode pipeline (`legacy/ingest.mjs`, `legacy/batch.mjs`) and the `/media` range handler (`legacy/range.mjs`) are retired. Do not run them against the shelf.

On load the deck goes straight to LIVE, the shared
wall-clock broadcast of the current channel. The TV language defaults from the visitor's country (`/api/geo` reads
`request.cf.country`: Suomi in Finland, International elsewhere); `?tv=suomi`, `#suomi`/`#suomi-komedia` or the saved
choice in localStorage win. Channels are categories (CH 1 = all tapes, then MTV, Komedia, Asiaa, Dokkarit, Visailut,
Meemit, Animaatio, Pelit, Eläimet, Mokat); the TV switch picks the language and the names follow it.
The mode key cycles LIVE → LOOP (repeat this tape) → SHUFFLE (random, no repeats until all have played). REW, FWD and
the scrubber put you on TIMESHIFT ±mm:ss; Skip, Back, a schedule click or a search hit on CONTINUOUS; GO LIVE returns to
the broadcast. Deploys: `scripts/deploy.mjs` and `LIBRARIAN.md`.

REC now stores suggestions in D1 `submissions` (migration `0002_submissions.sql`, 8 per IP per hour); the daily librarian
routine vets them and opens the pull requests, so the Worker needs no GitHub token.

## Candidate checks

`npm run candidates` (formerly `ingest`) reads `candidates/*.json`. A candidate needs `channel`, `year`, `signals` (at least three), `why`, and either a YouTube `embedId` or a `query`. A `match` regular expression has to hit the title yt-dlp returns, so a search cannot file a lookalike. The script then plays the embed in headless Chrome through the YouTube IFrame API, inside a page that sends a referrer. A bare embed URL is not the check: YouTube answers that with error 153.

The control tape is Rick Astley, `dQw4w9WgXcQ`. If that does not play, the script exits and does not edit the shelf. If YouTube answers with a sign-in wall, the checker records `bot` and also leaves the shelf alone. Error 150 from that wall is not the owner disabling the embed.

```bash
npm run candidates -- --limit 20
npm run candidates -- --recheck
npm run candidates -- --drop-dead
npm run candidates -- --pending
```

`--recheck` reports which current YouTube ids fail to play. `--drop-dead` removes those failures after the control plays, and leaves the calibration tapes in place. `--pending` gives a playing REC row a duration and takes it off `pending`. yt-dlp is expected at `~/.local/bin/yt-dlp` or `$YT_DLP`. Chrome is `/usr/bin/google-chrome` or `$CHROME`. Signals are whatever the candidate file says. The script does not invent them.

## Channels

`channels/suomi.json` and `channels/international.json` are the source of truth. `channels/categories.json` maps tapes onto the category channels; `channels/schedule.json` says how each channel airs; the build turns them into `channels/index.json` (the TV × channel lineup, with a `build` stamp) plus one JSON per category. `RESOURCES.md`, `/credits`, and `/takedown` are generated from them. Content changes touch only the files under `channels/` (`LIBRARIAN.md` §0 has the format and the validation command); the player code never embeds a title or a time.

Each item:

| Field | |
| --- | --- |
| `id` | Lowercase slug, unique in the file. |
| `title` | What the OSD prints. |
| `year` | Original release year. It has to be at least ten years ago (`UTC year − 10`). Notes say when a year is an era rather than a verified premiere. |
| `signals` | Three to five of `a` `b` `c` `d` `e`. See `CLASSIC.md`. |
| `why` | One line, at most 200 characters. |
| `original_url` | Original upload or site, or a Wayback snapshot. This is the SOURCE link. |
| `source` | `youtube`, `archive.org`, `vimeo`, or `other`. |
| `embedId` | YouTube id, archive.org identifier, Vimeo id, or (for `other`) the page URL. For a YouTube or archive play this matches `play.id_or_url`. |
| `play` | Required. `{ kind: "youtube" \| "archive" \| "link", id_or_url, official, uploader }`. The deck plays this and nothing else. |
| `duration` | Seconds. One UTC day’s lineup is drawn from these, not played as a fixed loop. |
| `added` | `YYYY-MM-DD` (UTC), the day the tape was filed. It airs from the next UTC day. Required on a hand-written row. |
| `note` | Short credit or context. |
| `credit` | Optional http(s) link. |
| `license` | Optional. `cc0`, `cc-by`, `cc-by-sa`, or `public-domain`. Printed on `/credits` when set; otherwise the page says the tape is embedded via YouTube or the Internet Archive, or is link only. |
| `tags` | Optional. Up to eight lowercase slugs. `npm run curate` groups the top tapes by them. |
| `creator` | Optional. One line, at most 80 characters. |
| `status` | Omit it for something on air. `pending` keeps a suggestion off the loop (`duration` may be 0) until a person confirms the embed, sets the duration, and removes the field. |

## Filing a tape

Press REC, or edit a channel file and open a pull request.

The card is one field: paste a link (YouTube, Vimeo, Internet Archive, Wayback, or any page with the video) and it files itself. The deck sends the TV that is on as the channel. Submit calls `POST /api/recommend`. The Worker checks the origin, the body size, a honeypot field, and a per-address rate limit (8 an hour), validates the URL, folds duplicates, and stores the row in D1 `submissions` as `pending`. The librarian routine (`LIBRARIAN.md`) takes title, year and duration from the link (`yt-dlp`), judges the signals, files the tape with `play`, and opens the pull request.

Before you push a hand-edited list:

```bash
npm run validate          # shelves, categories.json, schedule.json, sources.json
npm run resources         # rewrite RESOURCES.md, public/credits.html, public/takedown.html
npm run check-embeds      # weekly: oEmbed / archive.org metadata, needs a network. Not a CI gate.
```

`npm test` covers the day’s lineup, the vote shelf, curation, the schema, and the REC route (with GitHub mocked).

## Checks on a pull request

`.github/workflows/validate.yml` runs on pull requests and on pushes to `main`. It regenerates Worker types with `--check`, then runs the tests, the schema check, the `RESOURCES.md` diff, the typecheck, and the build. It does not deploy.

Fonts under `public/fonts/` are SIL Open Font License 1.1 (VT323, Silkscreen, Chakra Petch; licences next to the files). IBM Plex Sans and Mono load unmodified from Google Fonts. See `DESIGN.md` for the visual system.

# Plebflix — real human slop

A 24/7 living-room broadcast of classic internet videos. Two channels share one clock: **Suomi** (Finnish net culture, Flash, and the clips that escaped the message boards) and **International** (the early viral shelf). Everyone watching a channel is on the same tape at the same second. The set is a CRT on a VHS cabinet, and the deck buttons behave like a deck.

What counts as a classic is in `CLASSIC.md`: at least ten years old, and at least three of the five signals. Every card has an `original_url`. The glass shows it as SOURCE. Playback stays embedded in the tube (YouTube IFrame API, archive.org, Vimeo, or Ruffle for a `.swf` whose license allows it).

Nothing is rehosted. `sources.json` lists the shelves a suggestion may cite, including the Wayback Machine and archive.org. `RESOURCES.md` prints them.

## Watch it locally

```bash
npm install
npm run dev
```

`npm run dev` builds, then runs `wrangler dev`. The set is at <http://localhost:8787>.

PLAY, PAUSE, REW, FWD, STOP, and REC sit on the deck. CH+ / CH− and the tapes on the shelf switch between Suomi and International. PAUSE, REW, and FWD timeshift this browser only. PLAY, after a timeshift, returns to LIVE, and so does the LIVE pill on the screen. STOP is snow and a test card.

## Build output

`npm run build` writes two things and nothing else that deploy needs:

- `dist/worker.js` — one ES module, the Worker script
- `dist/assets/` — the static site, including `channels/` and `RESOURCES.md`

`wrangler.jsonc` points `main` at `dist/worker.js` and the assets binding at `dist/assets/`. A Wrangler deploy and a Cloudflare API upload use those same paths. The script is module syntax. Compatibility date is `2026-10-29`.

## Deploy

There is no GitHub Action that deploys. Run this from a machine logged into the Cloudflare account that owns the zone. `npm run build` has to come first. It is what produces the Worker script and the assets folder.

```bash
npm ci
npm run build
npx wrangler login
npx wrangler d1 create plebflix-tv
```

`npx wrangler d1 create plebflix-tv` prints a `database_id`. Paste that UUID onto the `d1_databases` entry in `wrangler.jsonc`. The database name stays `plebflix-tv`. The binding stays `DB`. `migrations_dir` is `migrations`. The migration file is `migrations/0001_votes.sql` (tables `votes` and `impressions`).

```bash
npx wrangler d1 migrations apply plebflix-tv --remote
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

`npx wrangler deploy` publishes Worker `plebflix-tv` from `dist/worker.js` and static files from `dist/assets/`. Custom domains are already in `wrangler.jsonc`: `plebflix.com` and `www.plebflix.com`, both with `custom_domain: true`. They attach on deploy when those hostnames are in a zone on the same account.

| Name | Kind |
| --- | --- |
| `plebflix-tv` | Worker name. |
| `dist/worker.js` | The script `main` points at. |
| `dist/assets/` | Assets directory. Binding `ASSETS`. |
| `plebflix-tv` | D1 database name. Binding `DB`. |
| `migrations/0001_votes.sql` | The migration to apply before votes will stick. |
| `GITHUB_TOKEN` | Secret. REC and `npm run curate -- --pr` need it. It is not in the repo. |
| `GITHUB_REPO` | Var, already set to `omnifinn/plebflix-tv`. |
| `RATE_LIMIT` | Optional KV namespace. Without it, rate limits stay in memory on each isolate. |
| `plebflix.com`, `www.plebflix.com` | Custom domains in `wrangler.jsonc`. |

For local play, apply the same migration to the local database and start the set:

```bash
npx wrangler d1 migrations apply plebflix-tv --local
npm run dev
```

`remote` is `false` on the D1 binding, so `wrangler dev` uses that local database. If `DB` is missing at runtime, vote routes return HTTP 503: “The tape deck has no vote shelf. Create the D1 database plebflix-tv, bind it as DB, and apply migrations.” If `GITHUB_TOKEN` is missing, REC returns HTTP 503: “The tape deck has no GitHub token. Set the GITHUB_TOKEN Worker secret and recommendations will open a pull request.”

## Worker configuration

The Worker name is `plebflix-tv`. Custom domains on the existing zone: `plebflix.com` and `www.plebflix.com`.

| Binding | What it is |
| --- | --- |
| `ASSETS` | Static assets from `dist/assets`. `/api/*` runs the Worker first. |
| `GITHUB_REPO` | `omnifinn/plebflix-tv`, a var already in `wrangler.jsonc`. |
| `GITHUB_TOKEN` | Secret. `npx wrangler secret put GITHUB_TOKEN`. Locally, put it in `.dev.vars` (gitignored). An empty value is treated as missing. |
| `RATE_LIMIT` | Optional KV. Without it, limits live in memory on the isolate. A shared limit needs a KV namespace bound as `RATE_LIMIT`. REC, votes, and play counts use different key prefixes. |
| `DB` | D1 database. The name is `plebflix-tv`. The binding is `DB`. Migrations live in `migrations/`. |

`POST /api/recommend` files a suggestion. If `GITHUB_TOKEN` is missing, the route returns HTTP 503 and the deck says: “The tape deck has no GitHub token. Set the GITHUB_TOKEN Worker secret and recommendations will open a pull request.”

## Votes

The remote under the channel keys is two thumbs. They vote on the tape that is on, including after a timeshift. A station ident is not a tape. The OSD flashes `UP ▲`, `DOWN ▼`, `ALREADY VOTED`, `NOT A TAPE`, or `VOTE FAILED`.

One vote per tape per browser. The id is `localStorage` key `plebflix-viewer` (a UUID). The choice is remembered in `plebflix-votes`. The Worker also rate-limits by IP: 60 votes an hour, and 600 play counts an hour. The IP is not stored. Creating the D1 database `plebflix-tv` and applying `migrations/0001_votes.sql` is in [Deploy](#deploy).

| Route | |
| --- | --- |
| `POST /api/vote` | `{ itemId, channel, vote: "up" or "down", viewerId }`. A second vote on the same tape returns 409 `ALREADY VOTED`. |
| `POST /api/impression` | `{ itemId, channel, viewerId }`. The set sends this once per tape per viewer per UTC day, when the tape actually starts. |
| `GET /api/stats?channel=suomi&day=YYYY-MM-DD` | `{ items: { [id]: { up, down, net, wilson, impressions } } }`. Only rows with `created_at` before that UTC midnight. `wilson` is the lower bound of the Wilson score interval at z = 1.96. `net` is up minus down. |

The day’s lineup uses that snapshot, so votes cast today change tomorrow’s draw, and every viewer who received the snapshot is on the same tape.

## The day’s lineup

The broadcast is one UTC day, built from the channel, the date, and the stats from before midnight. A seeded shuffle draws clips by weight, then holds each clip out for six hours. A short shelf cannot fill that window, so the deck falls back to the least-recently aired quarter and keeps going. An eight-second station ident airs between clips. It is drawn on the glass. It is not an embed.

Viewers who never reach `/api/stats` share the unweighted day with each other. The set waits up to a second and a half for stats, then ignores a late reply so the picture does not jump.

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

## Ingest

`npm run ingest` reads `candidates/*.json`. A candidate needs `channel`, `year`, `signals` (at least three), `why`, and either a YouTube `embedId` or a `query`. A `match` regular expression has to hit the title yt-dlp returns, so a search cannot file a lookalike. The script then plays the embed in headless Chrome through the YouTube IFrame API, inside a page that sends a referrer. A bare embed URL is not the check: YouTube answers that with error 153.

The control tape is Rick Astley, `dQw4w9WgXcQ`. If that does not play, the script exits and does not edit the shelf. If YouTube answers with a sign-in wall, the checker records `bot` and also leaves the shelf alone. Error 150 from that wall is not the owner disabling the embed.

```bash
npm run ingest -- --limit 20
npm run ingest -- --recheck
npm run ingest -- --drop-dead
npm run ingest -- --pending
```

`--recheck` reports which current YouTube ids fail to play. `--drop-dead` removes those failures after the control plays, and leaves the calibration tapes in place. `--pending` gives a playing REC row a duration and takes it off `pending`. yt-dlp is expected at `~/.local/bin/yt-dlp` or `$YT_DLP`. Chrome is `/usr/bin/google-chrome` or `$CHROME`. Signals are whatever the candidate file says. The script does not invent them.

## Channels

`channels/suomi.json` and `channels/international.json` are the source of truth. `RESOURCES.md` is generated from them.

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
| `embedId` | YouTube id, archive.org identifier, Vimeo id, or (for `other`) the page URL. A licensed `.swf` URL is allowed when `license` is set. |
| `duration` | Seconds. One UTC day’s lineup is drawn from these, not played as a fixed loop. |
| `note` | Short credit or context. |
| `credit` | Optional http(s) link. |
| `license` | Optional. `cc0`, `cc-by`, `cc-by-sa`, or `public-domain`. Required before a `.swf` may play in Ruffle. |
| `tags` | Optional. Up to eight lowercase slugs. `npm run curate` groups the top tapes by them. |
| `creator` | Optional. One line, at most 80 characters. |
| `status` | Omit it for something on air. `pending` keeps a suggestion off the loop (`duration` may be 0) until a person confirms the embed, sets the duration, and removes the field. |

## Filing a tape

Press REC, or edit a channel file and open a pull request.

The card is headed “File a tape.” It asks for a video link (YouTube, Vimeo, Internet Archive, Wayback, or another shelf in `sources.json`), a channel, a title, the original year, a one-line why, and at least three signals. An optional note sits under that. Submit calls `POST /api/recommend`. The Worker checks the origin, the body size, a honeypot field, and a per-IP rate limit, validates the URL and the classic rule, and refuses duplicates. It then opens a pull request on this repo that appends a `pending` item and regenerates `RESOURCES.md`. The pull request body includes a checklist for the five signals. The dialog shows the PR link.

Before you push a hand-edited list:

```bash
npm run validate          # schema
npm run resources         # rewrite RESOURCES.md
npm run verify-embeds     # oEmbed / archive.org metadata, needs a network
```

`npm test` covers the day’s lineup, the vote shelf, curation, the schema, and the REC route (with GitHub mocked).

## Checks on a pull request

`.github/workflows/validate.yml` runs on pull requests and on pushes to `main`. It regenerates Worker types with `--check`, then runs the tests, the schema check, the `RESOURCES.md` diff, the typecheck, and the build. It does not deploy.

Fonts under `public/fonts/` are the SIL Open Font License (VT323 and Special Elite). See `DESIGN.md` for the visual system.

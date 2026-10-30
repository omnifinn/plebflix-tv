# Plebflix TV — the daily librarian routine

Everything the morning routine needs: where submissions and votes live, how to vet,
how to ingest a tape, and how to redeploy. Since 2026-10-30 the deploy machine is Niko's Mac
(`~/Developer/personal/plebflix-tv`, `media/` mirrored from the live site) with a Cloudflare API token for the
account that owns plebflix.com (`f7b1f5882ab68d7dfd785ad6942b2db2`). The connector route below (Cursor box
`/workspace/deploy/plebflix-tv`, `user-Cloudflare` → `execute`, cursor-github, user-Google-drive) is the older path
and still works where those connectors exist.

Never touch the Worker `plebflix`, the repo `omnifinn/plebflix` (that is Bask) or any other zone/Worker.

## 0. Content lives in data files — the only files a content PR touches (Page, since 2026-10-30)

Niko, 2026-10-30: *"Another assistant (Page) adds content to this repo through daily PRs. … Page will only edit those data
files and `media/`, and will never touch the app code."* Everything the player shows is read from plain JSON under
`channels/` (it is served as-is at `/channels/*.json`; the code never embeds a title or a time). A content PR edits these
and nothing else:

| File | Holds | Edited when |
| --- | --- | --- |
| `channels/international.json` | the International shelf: one object per tape (fields below) | a tape is added, corrected or retired |
| `channels/suomi.json` | the Suomi shelf, same shape | same |
| `channels/categories.json` | the category channels (`channels`) and `assign`: tape id → one or more category ids | every new tape gets an `assign` entry |
| `channels/schedule.json` | how each channel airs: order, hold-out, ident length, fixed slots (format below) | a channel should play in file order, or a tape should air at a fixed time |
| `media/<lang>/<id>.mp4` + `.jpg` | the self-hosted file and poster (not in git; made on the deploy Mac by `scripts/ingest.mjs`) | see "Media" below |

**The gate: `npm run validate`.** CI (`.github/workflows/validate.yml`) runs it on every pull request; run it locally before
pushing. It checks both shelves field by field, that every tape has at least one category and every category exists,
and that every fixed slot names a tape on that shelf (and in that category), at a distinct UTC minute, with room before
the next slot. Every error is printed as `file: path message`. `npm run resources` must also be re-run when a shelf
changed (CI checks `RESOURCES.md` is current).

### Required fields per tape

| Field | Rule |
| --- | --- |
| `id` | lowercase slug, unique on the shelf; the file is `media/<lang>/<id>.mp4` |
| `title` | 1–160 characters |
| `year` | integer; the viral peak, 2013 or earlier (`CLASSIC.md`) |
| `signals` | 3–5 of `a b c d e` (`CLASSIC.md`), unique |
| `why` | one line, ≤ 200 characters |
| `original_url` | http(s) link to the original upload or a Wayback snapshot (the SOURCE pill) |
| `source` / `embedId` | `youtube` + 11-char id, `vimeo` + numeric id, `archive.org` + identifier, or `other` + the page URL; the embed is the fallback when the file fails |
| `duration` | integer seconds, 1–7200 (`yt-dlp -j URL` gives it); the daily schedule is drawn from these |
| `note` | string, ≤ 500 (credit / context; may be empty) |
| `added` | **the UTC day the tape was filed, `YYYY-MM-DD`.** The tape joins every daily schedule from the *next* UTC day, so a deploy never puts two open tabs on two different programmes. `scripts/ingest.mjs` and `scripts/batch.mjs` stamp it; a hand-written row must carry it. |
| `media` | `/media/<lang>/<id>.mp4` once the file exists; `poster` `/media/<lang>/<id>.jpg`; `media_bytes` its size |
| optional | `media_source` (direct URL to download the file from when the original will not), `credit` (URL), `creator`, `tags` (≤ 8 slugs), `license` (`cc0`/`cc-by`/`cc-by-sa`/`public-domain`, required for a `.swf`), `kind: "meme"` for a still turned into a 7 s loop, `status: "pending"` to keep a row off air |

### How a new tape slots into a channel's daily schedule

1. It is a row on its language shelf (`international.json` or `suomi.json`) with `added` = today's UTC date.
2. `categories.json` → `assign[id]` lists its categories. The tape is then on CH 1 of its TV (all tapes) and on each
   category channel named. Rules of thumb: long documentary-style → `dokkarit`, short and funny → `komedia`, game-show
   moments → `visailut`, music → `mtv`, stills/loops → `memes`.
3. From the next UTC day the generator (`public/schedule.js` `buildBroadcast`) includes it: on a `seeded` channel it is
   drawn by weight (unseen tapes get a small boost, so a new tape airs within its first day) and held out for
   `hold_out_hours` after each airing; on a `catalog` channel it plays in file order, so put the row where it should
   fall in the rotation.
4. For a fixed time, add a slot in `schedule.json` (below). Everything else is automatic: the programme for a day is the
   same on every device because it is built from the same shelf, the same `schedule.json`, the UTC date and the vote
   snapshot the Worker froze at midnight.

### Schedule definitions — `channels/schedule.json`

```json
{
  "defaults": { "order": "seeded", "hold_out_hours": 6, "ident_seconds": 8, "slots": [] },
  "channels": {
    "suomi":         { "slots": [{ "at": "19:00", "tape": "b5mies" }] },
    "suomi-dokkarit": { "order": "catalog", "hold_out_hours": 0 }
  }
}
```

| Key | Meaning |
| --- | --- |
| `channels.<id>` | `suomi` / `international` (CH 1 of that TV) or `<lang>-<category>` (`international-mtv`, `suomi-komedia`, …). A category channel without its own block inherits its TV's block; `defaults` fills whatever is left. |
| `order` | `seeded` (default): a deterministic weighted draw per UTC day, votes count. `catalog`: the shelf's file order, round and round, the same every day. |
| `hold_out_hours` | 0–24: a tape does not return inside this window (seeded order). |
| `ident_seconds` | 1–60: the station ident between tapes. |
| `slots` | `[{ "at": "HH:MM", "tape": "<id>" }]`, **UTC** (Helsinki = UTC+2 in winter, UTC+3 in summer). The tape starts at that second every day; the gap before it is filled with tapes that fit, then an ident. The tape must be on that shelf (and, for a category channel, assigned to that category), slots must not overlap. |

### Media

`media/` is not in git, so a PR cannot carry the file. Give the row `duration` (from `yt-dlp -j`) and, if the original
will not download, `media_source`. On the deploy Mac the routine then runs `node scripts/ingest.mjs --backfill`, which
downloads, transcodes (H.264/AAC ≤ 480p ≤ 24 MiB, poster) and writes `media`, `poster`, `media_bytes` and the exact
`duration` back into the shelf JSON; that change is committed and pushed before the deploy (§4).

## Where things are

| Thing | Where |
| --- | --- |
| Worker | `plebflix-tv` → plebflix.com, www.plebflix.com |
| D1 | `plebflix-tv`, id `bc743ec1-07f3-422b-bb5a-972aa6507996` (tables `votes`, `impressions`, `submissions`) |
| Catalog | `channels/suomi.json`, `channels/international.json` (git): every tape lives on exactly one language channel |
| Category channels | `channels/categories.json` (git): the category list (MTV, KOMEDIA, ASIAA, DOKKARIT, VISAILUT, MEMES, FLASH, GAMING, ELÄIMET, FAILS) and an `assign` map from tape id to one or more categories. Long documentary-style tapes go on DOKKARIT, short funny ones on KOMEDIA, game-show moments on VISAILUT. Every new tape needs an `assign` entry. |
| Media | `media/<channel>/<id>.mp4` + `.jpg` poster (on the box, **not** in git; served as Worker static assets at `/media/...`) |
| Dump folder | Google Drive "Plebflix TV dump" `1EOSMYYdkFys-PAOWIcrpO9X_fWMcYywY`, `links.txt` `15V44Y7VGoHOrjBDYiorhE5ozMzg4JUpV` |

## 1. Read D1 (connector `execute`)

```js
async () => {
  const q = (sql, params = []) => cloudflare.request({ method: "POST",
    path: `/accounts/${accountId}/d1/database/bc743ec1-07f3-422b-bb5a-972aa6507996/query`, body: { sql, params } })
    .then((r) => r.result[0].results);
  return {
    pending: await q("SELECT id, url, title, channel, year, why, signals, note, submitter, created_at FROM submissions WHERE status = 'pending' ORDER BY created_at"),
    sentiment: await q(`SELECT v.channel, v.item_id, SUM(v.vote = 1) AS up, SUM(v.vote = -1) AS down,
        (SELECT COUNT(*) FROM impressions i WHERE i.item_id = v.item_id AND i.channel = v.channel) AS plays
      FROM votes v GROUP BY v.channel, v.item_id ORDER BY (SUM(v.vote = -1) - SUM(v.vote = 1)) DESC`),
  };
}
```

After deciding:

```sql
-- ip_hash is only needed while the row is pending (the hourly limit); clear it on the way out.
UPDATE submissions SET status = 'accepted', pr_url = ?, review_note = ?, reviewed_at = datetime('now'), ip_hash = NULL WHERE id = ?;
UPDATE submissions SET status = 'rejected', review_note = ?, reviewed_at = datetime('now'), ip_hash = NULL WHERE id = ?;
```

## 2. Vet a submission

Classifier (`CLASSIC.md`): at least 10 years old (hard rule) **and** at least 3 of 5 signals
(a born online, b spread widely, c still quoted, d amateur/DIY, e defined its scene).
The REC card is a link only (since 2026-10-30): title, year, duration and uploader come from the link
(`yt-dlp -j --skip-download URL`; `scripts/ingest.mjs` fills them in when `--title`/`--year` are omitted), you judge the
signals and the channel (the deck sends the TV that was on). Check the link exists, the year is real, it isn't a duplicate
(`grep` the channel JSONs for the video id / original URL), and it isn't hateful, sexual, or cruel to a private person.
ÄM-IRK is on air (Niko asked for it). Apply the CLASSIC.md rule: viral/meme online, peak in 2013 or earlier, originals only (no remixes, compilations or cartoon versions unless the remix itself went viral). Recommend accept / reject / block to Niko with one line each.

Drop suggestions from votes: a tape with ≥ 12 votes and a Wilson lower bound < 0.32 (`npm run curate` uses the same rule;
calibration tapes B5mies, Kahen kilon siika, Ismo ja Seppo pyöräilee, Numa Numa, Leeroy Jenkins stay).

## 3. Ingest a tape

```bash
cd /workspace/deploy/plebflix-tv && export PATH=/workspace/node22/bin:$PATH
# a link (YouTube, Vimeo, archive.org, Wayback, most video pages yt-dlp knows, or a direct file URL)
node scripts/ingest.mjs --channel suomi --url "https://www.youtube.com/watch?v=XXXXXXXXXXX" \
  --signals a,b,d --why "One line on why it is a classic." [--title "Title"] [--year 2006] [--id slug] [--original URL] [--note "credit"]
# --title and --year default to what the link says (yt-dlp); give them when the upload date is not the release year
# a local video file (e.g. pulled from the Drive dump with DownloadFile)
node scripts/ingest.mjs --channel international --file /workspace/dump/clip.mov --title ... --year ... --signals ... --why ... --original "https://where-it-came-from"
# a static meme or GIF → 7 s looping MP4 with a title/year strip
node scripts/ingest.mjs --channel international --image https://…/meme.jpg --title "Doge" --year 2013 --signals a,b,c --why "..."
node scripts/ingest.mjs --check        # every catalog tape has its media file?
node scripts/ingest.mjs --backfill     # archive any tape that lacks media (uses media_source if set)
```

Batch: write a plan JSON (`[{id, channel, url, title, year, signals, why, cats, original_url?}]`) and run `node scripts/batch.mjs plan.json --jobs 4`. It downloads and transcodes in parallel, keeps progress in `plan.json.done.jsonl` (rerun to resume), and files the finished tapes into the channel JSON and `categories.json`.

Output: H.264/AAC MP4 (Main profile, yuv420p), ≤ 480p (360p for tapes over 10 min; anything over 20 min is trimmed), ≤ 24 MiB, faststart, plus a poster. The tape is appended to the channel JSON with
`media`, `poster`, `duration`, `media_bytes`; `original_url` stays the SOURCE link. If YouTube blocks the box,
point `--url` at an archive.org/Wayback copy and keep `--original` as the real original.

### Dump folder

1. `list_folder` on `1EOSMYYdkFys-PAOWIcrpO9X_fWMcYywY`; read `links.txt` (`read_file`). Lines are `URL | channel | note`; `#` lines are instructions.
2. For each video file: `DownloadFile` (cursor) → `/workspace/dump/`, then ingest with `--file`.
3. For each link: ingest with `--url`.
4. After a successful deploy, `trash_file` the processed files and rewrite `links.txt` back to its header (`update_file_content`).
   Note: the Drive connector uses the `drive.file` grant; if a file Niko dropped is not listed, ask him to open it once
   with the Grok Bot Drive app or share the folder, rather than guessing ids.

## 4. Deploy

From a machine that holds `media/` (this Mac; the live site can rebuild it: every `media`/`poster` path is served at
`https://plebflix.com/media/...`) and a token for the account pinned in `wrangler.jsonc` (`account_id`
f7b1f588…, the one that owns plebflix.com; the Mac's OAuth default `omnifinn` 141fee… does NOT hold the zone).

```bash
set -a; source ~/.config/cloudflare/plebflix-tv.env; set +a   # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
npm run validate                                               # the data gate (shelves, categories, schedule)
node scripts/ingest.mjs --backfill                             # files for tapes a content PR added (writes media/… into the JSON)
git add channels && git commit -m "librarian: media for …"     # if backfill changed a shelf
git push origin main                                           # GitHub first; CI must be green
npm run build && node scripts/ingest.mjs --check               # refuses if a tape's file is missing
npx wrangler d1 migrations apply plebflix-tv --remote          # before the code that needs the column
npx wrangler deploy
node scripts/deploy.mjs verify                                 # 200s on /, app.js, a channel, a tape (206), stats
```

A tape filed today (`added` = today, UTC) airs from tomorrow; deploy the same UTC day it was filed and no open tab ever
disagrees with a fresh one. Open tabs re-read `channels/*.json` within five minutes of a deploy (the build stamp in
`channels/index.json` changed).

Older path (no token, through the Cloudflare connector): `node scripts/deploy.mjs prepare` → run `dist/deploy/step1-session.js`
with `execute` → `node scripts/deploy.mjs upload dist/deploy/session.json` → run `dist/deploy/step3-publish.js` → `verify`.
New D1 migrations on that path: run their SQL through the connector `query` endpoint and insert the file name into `d1_migrations`.

## 5. GitHub

Commit catalog + code changes (never `media/`), then open a PR on `omnifinn/plebflix-tv` with the cursor-github connector
(one PR per accepted submission batch is fine) and record `pr_url` in `submissions`.

# Plebflix TV — the daily librarian routine

Everything the morning routine needs: where submissions and votes live, how to vet,
how to file a tape, and how to redeploy. Since 2026-10-30 the deploy machine is Niko's Mac
(`~/Developer/personal/plebflix-tv`) with a Cloudflare API token for the
account that owns plebflix.com (`f7b1f5882ab68d7dfd785ad6942b2db2`). The connector route below (Cursor box
`/workspace/deploy/plebflix-tv`, `user-Cloudflare` → `execute`, cursor-github, user-Google-drive) is the older path
and still works where those connectors exist.

Never touch the Worker `plebflix`, the repo `omnifinn/plebflix` (that is Bask) or any other zone/Worker.

## 0. Content lives in data files — the only files a content PR touches (Page, since 2026-10-30)

Niko, 2026-10-30, updated 2026-10-31: Page adds content through daily PRs and edits only the data files under
`channels/`. Page does not touch the app code, and the site does not host video, so a content PR never adds a file under
`media/` or `public/`. Everything the player shows is read from plain JSON under `channels/` (served as-is at
`/channels/*.json`; the code never embeds a title or a time). A content PR edits these and nothing else:

| File | Holds | Edited when |
| --- | --- | --- |
| `channels/international.json` | the International shelf: one object per tape (fields below) | a tape is added, corrected or retired |
| `channels/suomi.json` | the Suomi shelf, same shape | same |
| `channels/categories.json` | the category channels (`channels`) and `assign`: tape id → one or more category ids | every new tape gets an `assign` entry |
| `channels/schedule.json` | how each channel airs: order, hold-out, ident length, fixed slots (format below) | a channel should play in file order, or a tape should air at a fixed time |

**The gate: `npm run validate`.** CI (`.github/workflows/validate.yml`) runs it on every pull request; run it locally before
pushing. It checks both shelves field by field, that every tape has at least one category and every category exists,
and that every fixed slot names a tape on that shelf (and in that category), at a distinct UTC minute, with room before
the next slot. Every error is printed as `file: path message`. `npm run resources` must also be re-run when a shelf
changed (CI checks `RESOURCES.md` is current).

### Required fields per tape

| Field | Rule |
| --- | --- |
| `id` | lowercase slug, unique on the shelf |
| `title` | 1–160 characters |
| `year` | integer; the viral peak, 2013 or earlier (`CLASSIC.md`) |
| `signals` | 3–5 of `a b c d e` (`CLASSIC.md`), unique |
| `why` | one line, ≤ 200 characters |
| `original_url` | http(s) link to the original upload or a Wayback snapshot (the SOURCE pill) |
| `source` / `embedId` | `youtube` + the video id, `archive.org` + identifier, `vimeo` + numeric id, or `other` + the page URL. For `youtube` and `archive.org` this matches `play.id_or_url` |
| `play` | **required.** An ordered list of sources, best first: `[{ "kind": "youtube" \| "archive" \| "image", "id_or_url", "official": true \| false, "uploader" }]`. `youtube`: the creator's or an official channel's upload first (`official: true`), then other embeddable uploads. `archive`: an archive.org identifier plus `"file"`, a video file in that item (prefer the h.264 one); it streams from archive.org into the deck's own player. `wayback`: the Internet Archive's copy of a YouTube id, with an optional `"at"` capture date to pick a capture a browser can play. `image`: a still on `i.kym-cdn.com`, `upload.wikimedia.org`, `i.imgur.com` or `archive.org`. Nothing links off the site. `uploader` is one line (1-120), never an email address. The same `kind` + `id_or_url` cannot appear twice on a shelf |
| `duration` | integer seconds, 1–7200; the daily schedule is drawn from these. A still holds its slot for this many seconds |
| `note` | string, ≤ 500 (credit / context; may be empty) |
| `added` | **the UTC day the tape was filed, `YYYY-MM-DD`.** The tape joins every daily schedule from the *next* UTC day, so a deploy never puts two open tabs on two different programmes. A hand-written row must carry it. |
| optional | `credit` (URL), `creator`, `tags` (≤ 8 slugs), `license` (`cc0`/`cc-by`/`cc-by-sa`/`public-domain`), `kind: "meme"` for a still whose card links out, `status: "pending"` to keep a row off air |

`media`, `poster`, `media_bytes`, and `media_source` are rejected. Plebflix does not host the file or a downloaded frame. Posters come from `i.ytimg.com` or the player.

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

### Playback

Every tape plays through `play`, an ordered list. YouTube uses the IFrame Player API on `youtube-nocookie.com` and is
seeked to the scheduled offset, so LIVE stays the same for everyone. archive.org streams the named file into the deck's
own player. A still holds its slot. A refused source hands the same slot to the next one. Nothing is served from `/media`.
`npm run check-embeds` (YouTube oEmbed, then noembed; archive.org metadata and file; image fetch) exits 1 when any tape
has no live source. `npm run verify-all-play` loads every tape in Chrome and WebKit and reports PLAYING per tape; it is
the proof that a shelf change works, and a failure is fixed in the data.

## Where things are

| Thing | Where |
| --- | --- |
| Worker | `plebflix-tv` → plebflix.com, www.plebflix.com |
| D1 | `plebflix-tv`, id `bc743ec1-07f3-422b-bb5a-972aa6507996` (tables `votes`, `impressions`, `submissions`) |
| Catalog | `channels/suomi.json`, `channels/international.json` (git): every tape lives on exactly one language channel |
| Category channels | `channels/categories.json` (git): the category list (MTV, KOMEDIA, ASIAA, DOKKARIT, VISAILUT, MEMES, FLASH, GAMING, ELÄIMET, FAILS) and an `assign` map from tape id to one or more categories. Long documentary-style tapes go on DOKKARIT, short funny ones on KOMEDIA, game-show moments on VISAILUT. Every new tape needs an `assign` entry. |
| Playback | `play` on the tape: YouTube embed, archive.org stream, or a still from its public host, tried in order in the same slot. The site does not host the video. `npm run verify-all-play` proves each tape; `npm run check-embeds` fails on a tape with no live source. |
| Credits / takedown | `/credits` and `/takedown` (generated into `public/credits.html` and `public/takedown.html` by `npm run resources`). Rights email: `takedown@plebflix.com` |
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
(`yt-dlp -j --skip-download URL`), you judge the signals and the channel (the deck sends the TV that was on). Check the link exists, the year is real, it isn't a duplicate
(`grep` the channel JSONs for the video id / original URL), and it isn't hateful, sexual, or cruel to a private person.
ÄM-IRK is on air (Niko asked for it). Apply the CLASSIC.md rule: viral/meme online, peak in 2013 or earlier, originals only (no remixes, compilations or cartoon versions unless the remix itself went viral). Recommend accept / reject / block to Niko with one line each.

Drop suggestions from votes: a tape with ≥ 12 votes and a Wilson lower bound < 0.32 (`npm run curate` uses the same rule;
calibration tapes B5mies, Kahen kilon siika, Ismo ja Seppo pyöräilee, Numa Numa, Leeroy Jenkins stay).

## 3. File a tape

Add the row to `channels/suomi.json` or `channels/international.json` with the fields in §0, including `play`, and an
`assign` entry in `channels/categories.json`. Prefer the creator's own YouTube upload (`play.official: true`). If that
upload is gone and an archive.org item exists, use `kind: "archive"`. If no source plays, the tape does not go on the air. Do not download the file, do not write a poster into `public/`, and do not set
`media`. A still (the old 7-second loops) is an `image` source shown from its public host, not a rendered MP4.

```bash
npm run validate
npm run resources          # RESOURCES.md, public/credits.html, public/takedown.html
npm run check-embeds       # weekly; not a CI gate. Prints dead embeds.
```

`legacy/ingest.mjs` and `legacy/batch.mjs` are the old download-and-transcode pipeline. Do not run them. They write
fields the validator now rejects.

### Dump folder

1. `list_folder` on `1EOSMYYdkFys-PAOWIcrpO9X_fWMcYywY`; read `links.txt` (`read_file`). Lines are `URL | channel | note`; `#` lines are instructions.
2. A link becomes a shelf row with `play` (YouTube, archive.org, or a still). A tape with no source that plays does not go on the air: nothing is hosted here, and nothing sends a viewer off the site.
3. After the tape is filed and deployed, `trash_file` the processed files and rewrite `links.txt` back to its header (`update_file_content`).
   Note: the Drive connector uses the `drive.file` grant; if a file Niko dropped is not listed, ask him to open it once
   with the Grok Bot Drive app or share the folder, rather than guessing ids.

## 4. Deploy

**Default path since 2026-10-30: the ship protocol in `CLAUDE.md`** — Claude prepares (`node scripts/deploy.mjs ship`),
Page runs the three connector calls (`step0-migrate.js`, `step1-session.js`, `step3-publish.js`), then
`node scripts/deploy.mjs verify`. No API token or wrangler login on this Mac. The token path below is the fallback.

From this Mac, with a token for the account pinned in `wrangler.jsonc` (`account_id`
f7b1f588…, the one that owns plebflix.com; the Mac's OAuth default `omnifinn` 141fee… does NOT hold the zone).
`prepare` refuses if the asset manifest contains any `/media/` path.

```bash
set -a; source ~/.config/cloudflare/plebflix-tv.env; set +a   # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
npm run validate                                               # the data gate (shelves, categories, schedule)
git push origin main                                           # GitHub first; CI must be green
npm run build
npx wrangler d1 migrations apply plebflix-tv --remote          # before the code that needs the column
npx wrangler deploy
node scripts/deploy.mjs verify                                 # 200s on /, channels, /credits, /takedown, stats
```

After the first deploy of the embed-only build, purge `https://plebflix.com/media/*` from the Cloudflare cache. The Worker
no longer answers that path, but older assets were cached for a day.

A tape filed today (`added` = today, UTC) airs from tomorrow; deploy the same UTC day it was filed and no open tab ever
disagrees with a fresh one. Open tabs re-read `channels/*.json` within five minutes of a deploy (the build stamp in
`channels/index.json` changed).

Older path (no token, through the Cloudflare connector): `node scripts/deploy.mjs prepare` → run `dist/deploy/step1-session.js`
with `execute` → `node scripts/deploy.mjs upload dist/deploy/session.json` → run `dist/deploy/step3-publish.js` → `verify`.
New D1 migrations on that path: run their SQL through the connector `query` endpoint and insert the file name into `d1_migrations`.

## 5. GitHub

Commit catalog + code changes (no tape files), then open a PR on `omnifinn/plebflix-tv` with the cursor-github connector
(one PR per accepted submission batch is fine) and record `pr_url` in `submissions`.

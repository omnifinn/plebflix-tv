# Plebflix TV — the daily librarian routine

Everything the morning routine needs: where submissions and votes live, how to vet,
how to ingest a tape, and how to redeploy. No wrangler login and no API tokens:
authenticated Cloudflare calls go through the **Cloudflare connector** (`user-Cloudflare` → `execute`,
account `f7b1f5882ab68d7dfd785ad6942b2db2`), GitHub through the **cursor-github** connector,
Google Drive through **user-Google-drive**. Everything else runs on the box in `/workspace/deploy/plebflix-tv`
with `PATH=/workspace/node22/bin:$PATH`.

Never touch the Worker `plebflix`, the repo `omnifinn/plebflix` (that is Bask) or any other zone/Worker.

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
UPDATE submissions SET status = 'accepted', pr_url = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?;
UPDATE submissions SET status = 'rejected', review_note = ?, reviewed_at = datetime('now') WHERE id = ?;
```

## 2. Vet a submission

Classifier (`CLASSIC.md`): at least 10 years old (hard rule) **and** at least 3 of 5 signals
(a born online, b spread widely, c still quoted, d amateur/DIY, e defined its scene).
Check the link exists (`~/.local/bin/yt-dlp -j --skip-download URL`), the year is real, it isn't a duplicate
(`grep` the channel JSONs for the video id / original URL), and it isn't hateful, sexual, or cruel to a private person.
ÄM-IRK is on air (Niko asked for it). Apply the CLASSIC.md rule: viral/meme online, peak in 2013 or earlier, originals only (no remixes, compilations or cartoon versions unless the remix itself went viral). Recommend accept / reject / block to Niko with one line each.

Drop suggestions from votes: a tape with ≥ 12 votes and a Wilson lower bound < 0.32 (`npm run curate` uses the same rule;
calibration tapes B5mies, Kahen kilon siika, Ismo ja Seppo pyöräilee, Numa Numa, Leeroy Jenkins stay).

## 3. Ingest a tape

```bash
cd /workspace/deploy/plebflix-tv && export PATH=/workspace/node22/bin:$PATH
# a link (YouTube, Vimeo, archive.org, Wayback, most video pages yt-dlp knows, or a direct file URL)
node scripts/ingest.mjs --channel suomi --url "https://www.youtube.com/watch?v=XXXXXXXXXXX" \
  --title "Title" --year 2006 --signals a,b,d --why "One line on why it is a classic." [--id slug] [--original URL] [--note "credit"]
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

```bash
node scripts/deploy.mjs prepare            # build + manifest + dist/deploy/step1-session.js
```
Run `dist/deploy/step1-session.js` with the connector `execute` (write the result to a file), save as `dist/deploy/session.json`.
```bash
node scripts/deploy.mjs upload dist/deploy/session.json   # uploads new/changed files with the session JWT
```
Run `dist/deploy/step3-publish.js` with the connector `execute`. Then `node scripts/deploy.mjs verify`.
New D1 migrations: run their SQL through the connector `query` endpoint and insert the file name into `d1_migrations`.

## 5. GitHub

Commit catalog + code changes (never `media/`), then open a PR on `omnifinn/plebflix-tv` with the cursor-github connector
(one PR per accepted submission batch is fine) and record `pr_url` in `submissions`.

#!/usr/bin/env node
// Plebflix TV media ingest: download/transcode a tape, store it in the media dir,
// and add/update it in channels/<channel>.json. See README "Self-hosted media".
//
//   node scripts/ingest.mjs --channel suomi --url https://youtu.be/XXXX --title "..." --year 2004 \
//        --signals a,b,c --why "one line" [--id slug] [--original URL] [--note "..."] [--credit URL]
//   node scripts/ingest.mjs --channel international --file ./clip.mp4 --title ... --year ... --signals ... --why ...
//   node scripts/ingest.mjs --channel suomi --image ./meme.jpg|URL --title ... (30 s looping meme tape)
//   node scripts/ingest.mjs --backfill [--channel suomi] [--force]   (archive every catalog tape lacking media)
//   node scripts/ingest.mjs --check                                   (list catalog tapes whose media file is missing)
// A new tape gets `added: <UTC day>` and joins the daily schedule from the next UTC day (LIBRARIAN.md).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MEDIA_DIR = process.env.PLEBFLIX_MEDIA || path.join(ROOT, "media");
// yt-dlp: $YT_DLP, else ~/.local/bin/yt-dlp (the old deploy box), else whatever is on PATH (brew install yt-dlp).
const YTDLP = process.env.YT_DLP || [`${os.homedir()}/.local/bin/yt-dlp`].find((f) => existsSync(f)) || "yt-dlp";
// A bold sans for the meme strip: $PLEBFLIX_FONT, else the first of these that exists (Linux, then macOS).
const FONT = process.env.PLEBFLIX_FONT || [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
].find((f) => existsSync(f)) || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const MAX_BYTES = 24 * 1024 * 1024; // Workers static assets cap is 25 MiB per file
const MEME_SECONDS = 7;

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} failed: ${(r.stderr || "").slice(-600)}`);
  return r;
}
function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const j = JSON.parse(r.stdout);
  return { duration: Number(j.format?.duration || 0), video: j.streams?.find((s) => s.codec_type === "video"), audio: j.streams?.some((s) => s.codec_type === "audio") };
}
export function slugify(s) {
  return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "tape";
}
function loadChannel(ch) { return JSON.parse(readFileSync(path.join(ROOT, "channels", `${ch}.json`), "utf8")); }
function saveChannel(ch, doc) { writeFileSync(path.join(ROOT, "channels", `${ch}.json`), JSON.stringify(doc, null, 2) + "\n"); }

/** Download a URL with yt-dlp (YouTube, Vimeo, archive.org, Wayback, direct files...). Returns local path. */
export function download(url, workdir) {
  mkdirSync(workdir, { recursive: true });
  if (/\.(mp4|webm|mkv|mov|avi|flv|wmv|mpg|mpeg|m4v|3gp|gif|jpe?g|png|webp)(\?|$)/i.test(url) && !/youtube|youtu\.be|vimeo/.test(url)) {
    const out = path.join(workdir, "src" + path.extname(new URL(url).pathname).toLowerCase());
    run("curl", ["-sSfL", "--max-time", "600", "-A", "Mozilla/5.0 PlebflixArchiver", "-o", out, url]);
    return out;
  }
  const r = run(YTDLP, ["--no-warnings", "--no-playlist", "-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b", "-S", "res:480,vcodec:h264",
    "--merge-output-format", "mkv", "-o", path.join(workdir, "src.%(ext)s"), "--print", "after_move:filepath", url], { allowFail: true });
  const file = (r.stdout || "").trim().split("\n").pop();
  if (r.status !== 0 || !file || !existsSync(file)) throw new Error(`download failed: ${(r.stderr || "").trim().split("\n").pop()}`);
  return file;
}

/** What the link says about itself (yt-dlp JSON): title, upload year, duration, uploader, canonical page. null when unknown. */
export function probeSource(url) {
  const r = run(YTDLP, ["--no-warnings", "--no-playlist", "--skip-download", "-j", url], { allowFail: true });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    const j = JSON.parse(r.stdout.trim().split("\n")[0]);
    const date = String(j.upload_date || j.release_date || "");
    return {
      title: typeof j.title === "string" ? j.title.trim().slice(0, 160) : "",
      year: /^\d{8}$/.test(date) ? Number(date.slice(0, 4)) : undefined,
      duration: Number(j.duration) || 0,
      uploader: typeof j.uploader === "string" ? j.uploader.trim().slice(0, 80) : "",
      page: typeof j.webpage_url === "string" ? j.webpage_url : url,
    };
  } catch {
    return null;
  }
}

function drawtextEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%"); }

/** Transcode any video to web-friendly H.264/AAC MP4, ≤480p, faststart, under MAX_BYTES. */
export function transcode(input, output, { maxSeconds = 1200 } = {}) {
  const info = probe(input);
  const dur = Math.min(info.duration || 60, maxSeconds);
  // Long tapes (documentaries) drop to 360p and 64k audio so up to 20 min still fits (longer ones are trimmed to 20 min) one 24 MiB file.
  const long = dur > 600;
  const abr = long ? 64 : 96;
  const [W, H] = long ? [640, 360] : [854, 480];
  let kbps = Math.min(650, Math.floor((MAX_BYTES * 8) / dur / 1000) - abr - 14);
  if (kbps < 70) throw new Error(`clip too long for one file (${Math.round(dur)} s)`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const args = ["-y", "-v", "error", "-i", input];
    if (!info.audio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    args.push("-t", String(dur), "-map", "0:v:0", "-map", info.audio ? "0:a:0" : "1:a:0",
      "-vf", `scale=w='min(${W},iw)':h='min(${H},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=fps='min(30,source_fps)',scale=out_range=tv,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "26", "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
      "-c:a", "aac", "-b:a", `${abr}k`, "-ac", "2", "-ar", "44100", "-movflags", "+faststart", "-shortest", output);
    run("ffmpeg", args);
    if (statSync(output).size <= MAX_BYTES) return probe(output);
    kbps = Math.floor(kbps * 0.7);
  }
  throw new Error("could not fit under 24 MiB");
}

/** Turn a still image or GIF into a 30 s looping meme tape with a title/year strip. */
export function memeToVideo(input, output, { title, year, seconds = MEME_SECONDS }) {
  const isGif = /\.gif$/i.test(input);
  const label = drawtextEsc(`${title}${year ? "  ·  " + year : ""}`);
  const vf = [
    "scale=w=854:h=420:force_original_aspect_ratio=decrease:out_range=tv",
    "pad=854:480:(ow-iw)/2:(480-60-ih)/2+0:color=0x0B0D10",
    `drawbox=x=0:y=420:w=854:h=60:color=0x2B3036@1:t=fill`,
    `drawtext=fontfile=${FONT}:text='${label}':fontcolor=0x7CFF6B:fontsize=26:x=(w-text_w)/2:y=420+(60-text_h)/2`,
    `drawtext=fontfile=${FONT}:text='PLEBFLIX TV':fontcolor=0xFFB547@0.85:fontsize=16:x=w-tw-14:y=12`,
    "format=yuv420p",
  ].join(",");
  const args = ["-y", "-v", "error"];
  if (isGif) args.push("-ignore_loop", "0", "-i", input); else args.push("-loop", "1", "-framerate", "10", "-i", input);
  args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(seconds), "-vf", vf, "-r", isGif ? "15" : "10",
    "-c:v", "libx264", "-preset", "medium", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "28", "-tune", isGif ? "animation" : "stillimage", "-c:a", "aac", "-b:a", "32k",
    "-movflags", "+faststart", "-shortest", output);
  run("ffmpeg", args);
  return probe(output);
}

function poster(video, out, at) { run("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", out], { allowFail: true }); }

function sourceUrlFor(item) {
  if (item.source === "youtube" && /^[\w-]{11}$/.test(item.embedId || "")) return `https://www.youtube.com/watch?v=${item.embedId}`;
  if (item.source === "vimeo") return `https://vimeo.com/${item.embedId}`;
  if (item.source === "archive.org") return `https://archive.org/details/${item.embedId}`;
  return item.media_source || item.original_url;
}

/** Archive one catalog item (download + transcode + poster). Mutates the item. */
export function archiveItem(channel, item, { srcUrl, file, image, force } = {}) {
  const dir = path.join(MEDIA_DIR, channel);
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${item.id}.mp4`);
  const posterOut = path.join(dir, `${item.id}.jpg`);
  if (existsSync(out) && !force) { item.media = `/media/${channel}/${item.id}.mp4`; return item; }
  const work = path.join(os.tmpdir(), `plebflix-${channel}-${item.id}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    let input = file;
    if (image) input = /^https?:/.test(image) ? download(image, work) : image;
    else if (!input) input = download(srcUrl || sourceUrlFor(item), work);
    const tmp = path.join(work, "out.mp4");
    const meta = image || /\.(jpe?g|png|webp|gif)$/i.test(input)
      ? memeToVideo(input, tmp, { title: item.title, year: item.year })
      : transcode(input, tmp);
    copyFileSync(tmp, out);
    poster(out, posterOut, Math.min(5, meta.duration / 3));
    item.duration = Math.max(1, Math.round(meta.duration));
    item.media = `/media/${channel}/${item.id}.mp4`;
    if (existsSync(posterOut)) item.poster = `/media/${channel}/${item.id}.jpg`;
    item.media_bytes = statSync(out).size;
    if (image || meta.meme) item.kind = "meme";
    return item;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function addOrUpdate(channel, fields, opts) {
  const doc = loadChannel(channel);
  const id = fields.id || slugify(fields.title);
  let item = doc.items.find((i) => i.id === id);
  const isNew = !item;
  if (!item) item = { id };
  Object.assign(item, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
  item.id = id;
  if (opts.image) { item.kind = "meme"; item.source = item.source || "other"; item.embedId = item.embedId || opts.image; }
  const src = opts.srcUrl;
  if (src && !item.source) {
    const yt = src.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{11})/);
    if (yt) { item.source = "youtube"; item.embedId = yt[1]; }
    else if (/archive\.org\/details\/([^/?#]+)/.test(src)) { item.source = "archive.org"; item.embedId = src.match(/archive\.org\/details\/([^/?#]+)/)[1]; }
    else if (/vimeo\.com\/(\d+)/.test(src)) { item.source = "vimeo"; item.embedId = src.match(/vimeo\.com\/(\d+)/)[1]; }
    else { item.source = "other"; item.embedId = src; }
  }
  if (!item.source) { item.source = "other"; item.embedId = `/media/${channel}/${id}.mp4`; }
  item.original_url = item.original_url || src || opts.image || "";
  item.credit = item.credit || item.original_url;
  item.note = item.note || "";
  // The UTC day the tape was filed. It airs from the next day, so every open tab builds the same lineup.
  if (isNew) item.added = item.added || new Date().toISOString().slice(0, 10);
  archiveItem(channel, item, opts);
  if (isNew) doc.items.push(item);
  saveChannel(channel, doc);
  return item;
}

async function main() {
  if (has("--check")) {
    let missing = 0;
    for (const ch of ["suomi", "international"]) for (const item of loadChannel(ch).items) {
      if (!item.media || !existsSync(path.join(MEDIA_DIR, item.media.replace(/^\/media\//, "")))) { missing++; console.log(`missing ${ch}/${item.id}`); }
    }
    console.log(missing ? `${missing} tapes without a self-hosted file` : "every tape has a self-hosted file");
    process.exit(missing ? 1 : 0);
  }
  if (has("--backfill")) {
    const chans = flag("--channel") ? [flag("--channel")] : ["suomi", "international"];
    const only = flag("--only")?.split(",");
    for (const ch of chans) {
      const doc = loadChannel(ch);
      for (const item of doc.items) {
        if (only && !only.includes(item.id)) continue;
        if (item.media && existsSync(path.join(MEDIA_DIR, item.media.replace(/^\/media\//, ""))) && !has("--force")) continue;
        try { archiveItem(ch, item, { force: has("--force"), srcUrl: item.media_source }); console.log(`ok ${ch}/${item.id} ${item.duration}s ${(item.media_bytes / 1048576).toFixed(1)}MiB`); }
        catch (e) { console.log(`FAIL ${ch}/${item.id}: ${e.message}`); }
        saveChannel(ch, doc);
      }
    }
    return;
  }
  const channel = flag("--channel");
  if (!["suomi", "international"].includes(channel)) throw new Error("--channel suomi|international is required");
  const fields = {
    id: flag("--id"), title: flag("--title"), year: flag("--year") ? Number(flag("--year")) : undefined,
    signals: flag("--signals")?.split(",").map((s) => s.trim()), why: flag("--why"), note: flag("--note"),
    original_url: flag("--original"), credit: flag("--credit"),
  };
  const opts = { srcUrl: flag("--url"), file: flag("--file"), image: flag("--image"), force: has("--force") };
  if (!opts.srcUrl && !opts.file && !opts.image) throw new Error("give --url, --file or --image");
  // A REC card is only a link: ask the link for its title, year and creator when they were not given.
  if (opts.srcUrl && (!fields.title || !fields.year || !fields.original_url)) {
    const meta = probeSource(opts.srcUrl);
    if (meta) {
      fields.title ||= meta.title || undefined;
      fields.year ||= meta.year;
      fields.original_url ||= meta.page;
      if (meta.uploader && !fields.note) fields.note = `Uploaded by ${meta.uploader}; archived copy, credit to the original creators.`;
      console.error(`from the link: "${meta.title}" (${meta.year ?? "year unknown"}, ${Math.round(meta.duration)} s, ${meta.uploader || "uploader unknown"})`);
    }
  }
  if (!fields.title) throw new Error("--title is required (the link did not say)");
  if (!fields.year || fields.year > Math.min(2013, new Date().getUTCFullYear() - 10)) console.warn("warning: --year must be 2013 or earlier (viral peak 2013 or earlier) to pass the classifier");
  if (!fields.signals || fields.signals.length < 3) console.warn("warning: needs at least three of signals a-e");
  const item = addOrUpdate(channel, fields, opts);
  console.log(JSON.stringify(item, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

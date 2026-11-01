#!/usr/bin/env node
// Step 3a: find where each scored clip can play, without downloading anything.
//   node scripts/curation/resolve.mjs [limit=400]    -> data/curation/resolved.json (kept across runs)
// Per YouTube id: oEmbed (alive, title), archive.org youtube-<id> (exact copy, file lengths), Wayback yt/<id> (type).
// A clip with no id gets one from a paced YouTube search, matched against its name. Archive.org requests are serial and paced.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const limit = Number(process.argv[2] || 400);
const scored = JSON.parse(readFileSync("data/curation/scored.json", "utf8")).filter((c) => !c.onShelf && c.channel === "suomi").concat(JSON.parse(readFileSync("data/curation/scored.json", "utf8")).filter((c) => !c.onShelf && c.channel !== "suomi").slice(0, limit));
const PATH = "data/curation/resolved.json";
const done = new Map(existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")).map((r) => [r.clip, r]) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36", "accept-language": "en" };
const norm = (s) => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function oembed(id) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) { const d = await res.json(); return { alive: true, title: d.title, author: d.author_name }; }
  } catch { /* unknown */ }
  return { alive: false };
}
async function archiveCopy(id) {
  await sleep(350);
  try {
    const res = await fetch(`https://archive.org/metadata/youtube-${id}`, { signal: AbortSignal.timeout(20000) });
    const d = await res.json();
    if (!d.metadata) return null;
    const files = (d.files || []).filter((f) => /\.(mp4|webm)$/i.test(f.name) && !/\.ia\./.test(f.name)).map((f) => ({ name: f.name, length: Number(f.length) || 0 }));
    files.sort((a, b) => Number(/mp4$/i.test(b.name)) - Number(/mp4$/i.test(a.name)));
    return files.length ? { item: `youtube-${id}`, files, title: d.metadata.title, length: files[0].length } : null;
  } catch { return null; }
}
async function waybackCopy(id) {
  await sleep(350);
  try {
    const res = await fetch(`https://web.archive.org/web/2oe_/http://wayback-fakeurl.archive.org/yt/${id}`, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(25000) });
    const type = res.headers.get("content-type") || "";
    return res.ok && /video\/(mp4|webm)/.test(type) ? { type } : null;
  } catch { return null; }
}
async function search(clip) {
  await sleep(2500);
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${clip} original`)}`, { headers: UA, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return { error: res.status, hits: [] };
    const html = await res.text();
    const hits = [];
    for (const m of html.matchAll(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/g)) {
      hits.push({ id: m[1], title: m[2] });
      if (hits.length >= 6) break;
    }
    return { hits };
  } catch { return { hits: [] }; }
}
async function archiveSearch(clip) {
  await sleep(500);
  try {
    const q = encodeURIComponent(`title:(${clip.replace(/[^\p{L}\p{N} ]/gu, " ")}) AND mediatype:movies`);
    const res = await fetch(`https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=downloads&sort[]=downloads+desc&rows=4&output=json`, { signal: AbortSignal.timeout(25000) });
    return (await res.json()).response?.docs || [];
  } catch { return []; }
}

let walled = 0;
for (const clip of scored) {
  if (done.has(clip.clip) && done.get(clip.clip).done) continue;
  const row = { clip: clip.clip, score: clip.score, candidates: [], archiveSearch: [] };
  let ids = clip.yts.slice(0, 3);
  if (!ids.length && walled < 5) {
    const found = await search(clip.clip);
    if (found.error) walled += 1;
    const words = norm(clip.clip).split(" ").filter((w) => w.length > 2);
    ids = found.hits.filter((h) => words.length && words.every((w) => norm(h.title).includes(w))).slice(0, 3).map((h) => h.id);
    row.searched = found.hits.slice(0, 4);
  }
  for (const id of ids) {
    const [o, a, w] = await Promise.all([oembed(id), archiveCopy(id), waybackCopy(id)]);
    row.candidates.push({ id, ...o, archive: a, wayback: w });
  }
  if (!row.candidates.some((c) => c.archive || c.wayback)) row.archiveSearch = await archiveSearch(clip.clip);
  row.done = true;
  done.set(clip.clip, row);
  if (done.size % 20 === 0) writeFileSync(PATH, JSON.stringify([...done.values()], null, 1));
  if (done.size % 40 === 0) console.error(`${done.size} resolved`);
}
writeFileSync(PATH, JSON.stringify([...done.values()], null, 1));
const rows = [...done.values()];
console.log(`resolved ${rows.length}; exact archive ${rows.filter((r) => r.candidates.some((c) => c.archive)).length}; wayback ${rows.filter((r) => r.candidates.some((c) => c.wayback)).length}; youtube alive ${rows.filter((r) => r.candidates.some((c) => c.alive)).length}; search walled ${walled}`);

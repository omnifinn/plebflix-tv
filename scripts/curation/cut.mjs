#!/usr/bin/env node
// Step 2c: cut the harvest into the batches the cheap filter agents read.
//   node scripts/curation/cut.mjs <dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const S = process.argv[2];
mkdirSync(`${S}/b`, { recursive: true });
mkdirSync(`${S}/out`, { recursive: true });
const rd = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const c = (t) => String(t || "").replace(/\s+/g, " ");
const t = rd("data/curation/link-table.jsonl").filter((x) => (x.alive ? true : x.n >= 2));
const A = t.map((x) => `${x.id}\t${x.n}\t${x.first}\t${c(x.title).slice(0, 90) || "(dead link)"}\t${c(x.author).slice(0, 30)}`);
for (let i = 0, n = 1; i < A.length; i += 650, n++) writeFileSync(`${S}/b/links-${n}.tsv`, A.slice(i, i + 650).join("\n"));
console.log("links", A.length);
const VID = /\b(video|clip|meme|viral|flash|animation|sketch|machinima|skit)\b/i;
const LK = /youtube|youtu\.be|vimeo\.com/i;
const NOISE = /\b(api|sdk|kubernetes|startup|hiring|compiler|conference|lecture|keynote|podcast|tutorial|algorithm|codec|ffmpeg|encoder|browser|webrtc|transcod|html5|h\.?264)\b/i;
const B = [];
for (const x of [...rd("data/curation/raw/hn.jsonl"), ...rd("data/curation/raw/reddit.jsonl")]) {
  if (LK.test(x.text) || !VID.test(x.text) || NOISE.test(x.text) || x.text.length > 700) continue;
  B.push(`${x.src}|${x.id}\t${c(x.author)}\t${c(x.thread).slice(0, 50)}\t${c(x.text).slice(0, 260)}`);
}
const cap = Math.min(B.length, 9600);
const per = Math.ceil(cap / 12);
console.log("comments", B.length, "used", cap);
for (let i = 0, n = 1; i < cap; i += per, n++) writeFileSync(`${S}/b/comments-${n}.tsv`, B.slice(i, i + per).join("\n"));
const w = rd("data/curation/raw/wiki.jsonl").filter((x) => !/most-subscribed|web television/.test(x.page));
writeFileSync(`${S}/b/list-wiki.txt`, w.map((x) => `${x.page} § ${c(x.section).slice(0, 30)} :: ${c(x.text).slice(0, 240)}`).join("\n"));
writeFileSync(`${S}/b/list-kym.txt`, rd("data/curation/raw/kym.jsonl").map((x) => `${x.id}\t${x.year}\t${c(x.title).slice(0, 70)}\t${x.originIds[0] || ""}\t${c(x.text).slice(0, 180)}`).join("\n"));
writeFileSync(`${S}/b/list-wayback.txt`, rd("data/curation/raw/wayback.jsonl").map((x) => `## ${x.page} @ ${x.at}\n${c(x.text).slice(0, 5000)}`).join("\n"));
writeFileSync(`${S}/b/list-fi.txt`, rd("data/curation/raw/fi.jsonl").map((x) => `[${x.src}] ${c(x.thread).slice(0, 70)} :: ${(x.links || []).join(" ")} ${c(x.text).slice(0, 500)}`).join("\n"));
for (const k of ["international", "suomi"]) writeFileSync(`${S}/b/shelf-${k}.txt`, JSON.parse(readFileSync(`channels/${k}.json`, "utf8")).items.map((x) => `${x.id}\t${x.title}`).join("\n"));

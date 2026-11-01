#!/usr/bin/env node
// Step 2b: count independent mentions per YouTube id across the harvest, and read each id's title from oEmbed.
//   node scripts/curation/link-table.mjs        -> data/curation/link-table.jsonl
// Independent = a distinct author (or source page). A dead id stays in the table, marked, because it may still have an archive copy.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// hn.jsonl is committed gzipped: gunzip it before re-running.
const rd = (file) => (existsSync(`data/curation/raw/${file}`) ? readFileSync(`data/curation/raw/${file}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const YT = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^\s"<>]*v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
const table = new Map();
const add = (id, who, src, at = "", url = "") => {
  if (!table.has(id)) table.set(id, { id, who: new Set(), srcs: new Set(), first: "", urls: [] });
  const row = table.get(id);
  row.who.add(who);
  row.srcs.add(src);
  if (at && (!row.first || at < row.first)) row.first = at;
  if (url && row.urls.length < 3) row.urls.push(url);
};
for (const r of [...rd("hn.jsonl"), ...rd("reddit.jsonl"), ...rd("fi.jsonl")]) {
  const text = `${r.text} ${(r.links || []).join(" ")}`;
  for (const id of new Set([...text.matchAll(YT)].map((m) => m[1]))) add(id, `${r.src}:${r.author || r.id}`, r.src, r.at, r.url);
}
for (const r of rd("kym.jsonl")) for (const id of r.originIds) add(id, `kym:${r.id}`, "kym", "", r.url);
const keep = [...table.values()].filter((row) => row.who.size >= 2 || row.srcs.has("kym") || row.srcs.has("suomi24") || row.srcs.has("reddit") || (row.first && row.first < "2014"));
console.error(`ids ${table.size}, reading titles for ${keep.length}`);
const out = [];
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < keep.length) {
    const row = keep[cursor++];
    let title = "", author = "", alive = false;
    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${row.id}`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) { const d = await res.json(); title = d.title; author = d.author_name; alive = true; }
    } catch { /* stays dead-or-unknown */ }
    out.push({ id: row.id, n: row.who.size, srcs: [...row.srcs], first: row.first.slice(0, 10), title, author, alive, urls: row.urls });
  }
}));
out.sort((a, b) => b.n - a.n);
writeFileSync("data/curation/link-table.jsonl", out.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.error(`alive ${out.filter((r) => r.alive).length} of ${out.length}`);

#!/usr/bin/env node
// Writes data/curation/blocks.json: the filed tapes by program block, ranked by score.
import { readFileSync, writeFileSync } from "node:fs";
const scored = JSON.parse(readFileSync("data/curation/scored.json", "utf8"));
const byYt = new Map();
for (const c of scored) for (const y of c.yts) if (!byYt.has(y)) byYt.set(y, c);
const rows = [];
for (const ch of ["international", "suomi"]) for (const t of JSON.parse(readFileSync(`channels/${ch}.json`, "utf8")).items) {
  if (!t.added || !t.tags?.length) continue;
  const yt = t.original_url.split("v=")[1];
  const c = byYt.get(yt);
  rows.push({ id: t.id, title: t.title, channel: ch, year: t.year, block: t.tags[0], score: c?.score || 0, mentions: c?.mentions || 0, sourceKinds: c?.sourceKinds || [], first: t.play[0].kind });
}
rows.sort((a, b) => b.score - a.score);
const blocks = {};
for (const r of rows) (blocks[r.block] ||= []).push(r.id);
writeFileSync("data/curation/blocks.json", JSON.stringify({ blocks, tapes: rows }, null, 1));
const n = (ch) => rows.filter((r) => r.channel === ch).length;
console.log(`international ${n("international")} suomi ${n("suomi")}`);
console.log(Object.entries(blocks).map(([k, v]) => `${k}: ${v.length}`).join("\n"));
console.log(rows.slice(0, 20).map((r, i) => `${i + 1}. ${r.title} (${r.year}) score ${r.score}`).join("\n"));

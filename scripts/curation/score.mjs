#!/usr/bin/env node
// Step 2d: dedupe the agents' rows to canonical clips and score by independent mentions.
//   node scripts/curation/score.mjs <agentOutDir>   -> data/curation/filtered.jsonl, scored.json
// Score = distinct people or pages across sources, plus 3 per kind of source (the link table's n is the count of authors).
// A clip already on a shelf (same video id or same normalised title) is kept in the file, flagged onShelf.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
const norm = (s) => String(s || "").normalize("NFKD").toLowerCase().replace(/[̀-ͯ]/g, "")
  .replace(/\b(the|original|official|video|full|hd|hq|meme|a|an|flash|animation|cartoon|song|clip)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const rows = [];
for (const name of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(`${dir}/${name}`, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push({ ...JSON.parse(line), file: name.replace(".jsonl", "") }); } catch { console.error(`bad row in ${name}: ${line.slice(0, 80)}`); }
  }
}
writeFileSync("data/curation/filtered.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const clips = new Map();
const byYt = new Map();
const key = (r) => (r.yt && byYt.get(r.yt)) || norm(r.clip);
for (const r of rows) {
  if (!r.clip) continue;
  const k = key(r);
  if (!k) continue;
  if (!clips.has(k)) clips.set(k, { key: k, clip: r.clip, yts: {}, years: {}, who: new Set(), kinds: new Set(), channel: {}, kind: {}, sources: new Set(), desc: r.desc || "" });
  const c = clips.get(k);
  if (r.yt) { c.yts[r.yt] = (c.yts[r.yt] || 0) + (r.mentions || 1); byYt.set(r.yt, k); }
  if (r.year) c.years[r.year] = (c.years[r.year] || 0) + 1;
  if (r.channel) c.channel[r.channel] = (c.channel[r.channel] || 0) + 1;
  if (r.kind) c.kind[r.kind] = (c.kind[r.kind] || 0) + 1;
  const family = r.file.split("-")[0];
  c.kinds.add(family);
  if (r.author) c.who.add(`${r.ref?.split("|")[0]}:${r.author}`);
  if (r.page) c.who.add(`page:${r.page}`);
  if (r.slug) c.who.add(`kym:${r.slug}`);
  for (const s of r.sources || []) { try { c.who.add(`web:${new URL(s).hostname}`); c.sources.add(s); } catch { /* not a URL */ } }
  if (r.mentions) c.linkMentions = Math.max(c.linkMentions || 0, r.mentions);
}
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];
const shelf = new Map();
for (const ch of ["international", "suomi"]) {
  for (const t of JSON.parse(readFileSync(`channels/${ch}.json`, "utf8")).items) {
    shelf.set(`n:${norm(t.title)}`, t.id);
    shelf.set(`n:${norm(t.id.replace(/-/g, " "))}`, t.id);
    for (const p of t.play) if (p.kind === "youtube" || p.kind === "wayback") shelf.set(`y:${p.id_or_url}`, t.id);
  }
}
const out = [...clips.values()].map((c) => {
  const year = Number(top(c.years) || 0);
  const mentions = (c.linkMentions || 0) + c.who.size;
  const ytIds = Object.keys(c.yts);
  const onShelf = ytIds.map((y) => shelf.get(`y:${y}`)).find(Boolean) || shelf.get(`n:${norm(c.clip)}`) || "";
  return { clip: c.clip, score: mentions + 3 * c.kinds.size, mentions, sourceKinds: [...c.kinds], year, channel: top(c.channel) || "international", kind: top(c.kind) || "", yts: Object.entries(c.yts).sort((a, b) => b[1] - a[1]).map((e) => e[0]), onShelf, sources: [...c.sources].slice(0, 5), desc: c.desc };
}).filter((c) => !c.year || c.year <= 2013).sort((a, b) => b.score - a.score);
writeFileSync("data/curation/scored.json", JSON.stringify(out, null, 1));
console.log(`rows ${rows.length}; clips ${out.length}; new ${out.filter((c) => !c.onShelf).length}`);
console.log(out.filter((c) => !c.onShelf).slice(0, 60).map((c) => `${c.score} ${c.channel[0]} ${c.year} ${c.clip} [${c.sourceKinds}] ${c.yts[0] || ""}`).join("\n"));

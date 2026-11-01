#!/usr/bin/env node
// Step 2a: cut the raw harvest into compact batches for the cheap filter agents.
//   node scripts/curation/batch.mjs <outDir> [perBatch=450] [maxText=320]
// Each line: ref <TAB> author-or-source <TAB> thread <TAB> text. Link-carrying rows go first; rows that cannot name a clip are dropped.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const [outDir, perBatch = "450", maxText = "320"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const LINK = /youtube|youtu\.be|vimeo\.com|archive\.org\/details|newgrounds\.com|albinoblacksheep|ytmnd|ebaumsworld|homestarrunner/i;
// Only worth an LLM read: a link, or words that ask for or describe a video.
const VIDEOISH = /\b(video|clip|youtube|flash|animation|meme|viral|ytmnd|newgrounds|machinima|sketch|short film|web ?series|skit|video?t|klippi|meemi|nettivideo|pätkä|klassikko)\b/i;
const NOISE = /\b(api|sdk|kubernetes|startup|hiring|compiler|tutorial|conference talk|lecture|keynote|podcast|pull request|algorithm|lex fridman|3blue1brown|rust|golang)\b/i;
const rows = [];
for (const name of readdirSync("data/curation/raw").filter((file) => file.endsWith(".jsonl"))) {
  if (name === "wiki.jsonl" || name === "kym.jsonl" || name === "wayback.jsonl") continue; // handled as lists, not comments
  for (const line of readFileSync(`data/curation/raw/${name}`, "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line);
    const hasLink = LINK.test(row.text) || row.links?.length;
    if (!hasLink && !VIDEOISH.test(row.text)) continue;
    if (NOISE.test(row.text) && !/\b(viral|meme|old|classic|nostalg)/i.test(row.text)) continue;
    if (row.text.length < 12) continue;
    rows.push({ row, hasLink: Boolean(hasLink) });
  }
}
rows.sort((a, b) => Number(b.hasLink) - Number(a.hasLink));
const size = Number(perBatch);
let n = 0;
const clean = (text) => String(text || "").replace(/[\t\n\r]+/g, " ");
for (let at = 0; at < rows.length; at += size) {
  n += 1;
  const lines = rows.slice(at, at + size).map(({ row }) => {
    const text = row.links?.length ? `${row.links.join(" ")} ${row.text}` : row.text;
    return `${row.src}|${row.id}\t${clean(row.author || row.sub || "")}\t${clean(row.thread).slice(0, 80)}\t${clean(text).slice(0, Number(maxText))}`;
  });
  writeFileSync(`${outDir}/batch-${String(n).padStart(3, "0")}.tsv`, `${lines.join("\n")}\n`);
}
console.log(JSON.stringify({ rows: rows.length, withLink: rows.filter((r) => r.hasLink).length, batches: n }));

#!/usr/bin/env node
// Reads the upload date of a YouTube id from the oldest Wayback capture of its watch page. Paced; archive.org cuts off bursts.
//   node scripts/curation/upload-dates.mjs id id ...  -> merges into data/curation/upload-dates.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const PATH = "data/curation/upload-dates.json";
const out = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const id of process.argv.slice(2)) {
  if (out[id]?.date) continue;
  await sleep(3000);
  try {
    const cdx = await (await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`youtube.com/watch?v=${id}`)}&filter=statuscode:200&limit=2&output=json`, { signal: AbortSignal.timeout(30000) })).json();
    const stamp = cdx[1]?.[1];
    if (!stamp) { out[id] = { first: "" }; continue; }
    await sleep(3000);
    const html = await (await fetch(`https://web.archive.org/web/${stamp}id_/https://www.youtube.com/watch?v=${id}`, { signal: AbortSignal.timeout(45000) })).text();
    const date = html.match(/"(?:uploadDate|publishDate)":"(\d{4}-\d{2}-\d{2})/)?.[1] || html.match(/itemprop="(?:datePublished|uploadDate)" content="(\d{4}-\d{2}-\d{2})/)?.[1] || html.match(/(?:Published|Uploaded) on ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1] || "";
    const seconds = Number(html.match(/"lengthSeconds":"?(\d+)/)?.[1] || 0);
    out[id] = { first: stamp, date, seconds };
    console.log(id, stamp, date, seconds);
  } catch (error) { console.error(id, error.message); }
  writeFileSync(PATH, JSON.stringify(out, null, 1));
}
writeFileSync(PATH, JSON.stringify(out, null, 1));

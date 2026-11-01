#!/usr/bin/env node
// Step 3b: turn picks.json into shelf rows. Non-YouTube sources first, YouTube last. Nothing is downloaded.
//   node scripts/curation/file-tapes.mjs [--drop id,id]
// Records the earliest Wayback capture of each watch page in the filing report. Judging the year happens in picks.json.
// Duration: archive.org length, then the captured page, then ffprobe of the Wayback stream header (paced).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const at = process.argv.indexOf("--drop");
const drop = new Set(at > -1 ? process.argv[at + 1].split(",") : []);
const today = new Date().toISOString().slice(0, 10);
const picks = JSON.parse(readFileSync("data/curation/picks.json", "utf8"));
const resolved = new Map(JSON.parse(readFileSync("data/curation/resolved.json", "utf8")).flatMap((r) => r.candidates.map((c) => [c.id, c])));
const cats = JSON.parse(readFileSync("channels/categories.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const dates = JSON.parse(readFileSync("data/curation/upload-dates.json", "utf8"));

async function firstCapture(id) {
  await sleep(600);
  try {
    const res = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`youtube.com/watch?v=${id}`)}&limit=1&output=json`, { signal: AbortSignal.timeout(30000) });
    const rows = await res.json();
    return rows[1]?.[1] || "";
  } catch { return "?"; }
}
function probe(id) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `https://web.archive.org/web/2oe_/http://wayback-fakeurl.archive.org/yt/${id}`], { timeout: 60000, encoding: "utf8" });
    return Math.round(Number(out.trim()) || 0);
  } catch { return 0; }
}
for (const channel of ["international", "suomi"]) {
  const doc = JSON.parse(readFileSync(`channels/${channel}.json`, "utf8"));
  const have = new Set(doc.items.map((t) => t.id));
  for (const [id, title, yt, year, block, assign, sig, why] of picks[channel]) {
    if (drop.has(id) || have.has(id)) continue;
    const r = resolved.get(yt) || {};
    const first = await firstCapture(yt);
    const play = [];
    const uploader = (r.author || "unknown uploader").slice(0, 120);
    if (r.archive) play.push({ kind: "archive", id_or_url: r.archive.item, file: r.archive.files[0].name, official: false, uploader: "Internet Archive" });
    if (r.wayback) play.push({ kind: "wayback", id_or_url: yt, official: false, uploader: "Internet Archive" });
    if (r.alive) play.push({ kind: "youtube", id_or_url: yt, official: false, uploader });
    const dated = dates[yt] || {};
    let duration = Math.round(r.archive?.length || 0) || dated.seconds || 0;
    if (!duration && r.wayback) { await sleep(5000); duration = probe(yt); }
    report.push({ id, yt, year, first, sources: play.map((p) => p.kind).join(","), duration });
    if (!play.length) continue;
    if (!duration) { report.at(-1).skipped = "no duration known"; continue; }
    const first0 = play[0];
    doc.items.push({
      id, title, year,
      source: first0.kind === "archive" ? "archive.org" : "youtube",
      embedId: first0.kind === "archive" ? first0.id_or_url : yt,
      play, duration,
      note: why,
      credit: `https://www.youtube.com/watch?v=${yt}`,
      signals: sig.replace(/\s/g, "").split(""),
      why,
      original_url: `https://www.youtube.com/watch?v=${yt}`,
      tags: [block],
      added: today,
    });
    cats.assign[id] = assign;
  }
  writeFileSync(`channels/${channel}.json`, `${JSON.stringify(doc, null, 2)}\n`);
}
writeFileSync("channels/categories.json", `${JSON.stringify(cats, null, 2)}\n`);
writeFileSync("data/curation/filing-report.json", JSON.stringify(report, null, 1));
console.log(report.map((r) => `${r.id} ${r.year} first=${r.first.slice(0, 4)} ${r.sources} ${r.duration}s ${r.skipped || ""}`).join("\n"));

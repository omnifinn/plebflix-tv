#!/usr/bin/env node
// Batch ingest: node scripts/batch.mjs plan.json [--jobs 3]
// plan.json = [{ id, channel: "suomi"|"international", url, title, year, signals:[...], why, cats:[...], original_url?, note?, maxSeconds? }]
// Downloads + transcodes in parallel (child processes), then files every finished tape into the channel JSON
// and categories.json in one go. Progress is kept in <plan>.done.jsonl so a rerun resumes.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , planFile, ...rest] = process.argv;
if (!planFile) {
  console.log("usage: node scripts/batch.mjs plan.json [--jobs 3] [--file-only]");
  process.exit(1);
}
const jobs = Number(rest[rest.indexOf("--jobs") + 1]) || 3;
const fileOnly = rest.includes("--file-only");
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const doneFile = `${planFile}.done.jsonl`;
const done = new Map();
if (existsSync(doneFile)) for (const line of readFileSync(doneFile, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(line); done.set(r.id, r); }

function worker(entry) {
  return new Promise((resolve) => {
    const code = `
      import { archiveItem } from ${JSON.stringify(path.join(ROOT, "scripts/ingest.mjs"))};
      import { transcode } from ${JSON.stringify(path.join(ROOT, "scripts/ingest.mjs"))};
      const e = ${JSON.stringify(entry)};
      try {
        const item = archiveItem(e.channel, { id: e.id, title: e.title, year: e.year }, { srcUrl: e.url, image: e.image });
        console.log(JSON.stringify({ ok: true, id: e.id, duration: item.duration, media: item.media, poster: item.poster, media_bytes: item.media_bytes, kind: item.kind }));
      } catch (err) { console.log(JSON.stringify({ ok: false, id: e.id, error: String(err.message || err).slice(0, 300) })); }`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      const line = out.trim().split("\n").pop();
      let r;
      try { r = JSON.parse(line); } catch { r = { ok: false, id: entry.id, error: out.slice(-300) || "worker crashed" }; }
      appendFileSync(doneFile, JSON.stringify(r) + "\n");
      console.log(`${r.ok ? "ok  " : "FAIL"} ${entry.channel}/${entry.id}${r.ok ? ` ${r.duration}s ${(r.media_bytes / 1048576).toFixed(1)}MiB` : ` ${r.error}`}`);
      resolve(r);
    });
  });
}

if (!fileOnly) {
  const queue = plan.filter((e) => !done.get(e.id)?.ok);
  const run = async () => { while (queue.length) { const e = queue.shift(); done.set(e.id, await worker(e)); } };
  await Promise.all(Array.from({ length: jobs }, run));
}

// file results into the catalog
const docs = {};
const load = (ch) => (docs[ch] ||= JSON.parse(readFileSync(path.join(ROOT, "channels", `${ch}.json`), "utf8")));
const catsPath = path.join(ROOT, "channels", "categories.json");
const cats = JSON.parse(readFileSync(catsPath, "utf8"));
let filed = 0;
for (const e of plan) {
  const r = done.get(e.id);
  if (!r?.ok) continue;
  const doc = load(e.channel);
  const item = {
    id: e.id, title: e.title, year: e.year, source: /youtube|youtu\.be/.test(e.url) ? "youtube" : /archive\.org/.test(e.url) ? "archive.org" : /vimeo/.test(e.url) ? "vimeo" : "other",
    embedId: (e.url.match(/[?&]v=([\w-]{11})/) || e.url.match(/youtu\.be\/([\w-]{11})/) || [])[1] || e.url,
    duration: r.duration, note: e.note || "Archived copy of the linked upload; credit to its original creators.",
    credit: e.original_url || e.url, signals: [...new Set(e.signals)].sort(), why: e.why, original_url: e.original_url || e.url,
    media: r.media, ...(r.poster ? { poster: r.poster } : {}), media_bytes: r.media_bytes, ...(r.kind ? { kind: r.kind } : {}),
  };
  if (e.tags) item.tags = e.tags;
  const at = doc.items.findIndex((i) => i.id === e.id);
  if (at >= 0) doc.items[at] = { ...doc.items[at], ...item };
  else doc.items.push(item);
  if (e.cats?.length) cats.assign[e.id] = [...new Set([...(cats.assign[e.id] || []), ...e.cats])];
  filed += 1;
}
for (const [ch, doc] of Object.entries(docs)) writeFileSync(path.join(ROOT, "channels", `${ch}.json`), JSON.stringify(doc, null, 2) + "\n");
writeFileSync(catsPath, JSON.stringify(cats, null, 2) + "\n");
const failed = plan.filter((e) => done.get(e.id) && !done.get(e.id).ok).map((e) => e.id);
console.log(`filed ${filed}/${plan.length}; failed ${failed.length}${failed.length ? ": " + failed.join(", ") : ""}`);

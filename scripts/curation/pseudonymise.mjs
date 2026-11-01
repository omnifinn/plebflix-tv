#!/usr/bin/env node
// Replaces commenter names in the committed corpus with a short hash: mentions stay countable, names are not republished.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const h = (s) => `u${createHash("sha256").update(String(s)).digest("hex").slice(0, 10)}`;
const clean = (text) => text.split("\n").map((line) => {
  if (!line.trim()) return line;
  const row = JSON.parse(line);
  if (row.author) row.author = h(row.author);
  return JSON.stringify(row);
}).join("\n");
for (const dir of ["data/curation/raw", "data/curation/agents"]) for (const f of readdirSync(dir)) {
  const p = `${dir}/${f}`;
  if (f.endsWith(".jsonl.gz")) writeFileSync(p, gzipSync(clean(gunzipSync(readFileSync(p)).toString()), { level: 9 }));
  else if (f.endsWith(".jsonl")) writeFileSync(p, clean(readFileSync(p, "utf8")));
}
const filtered = "data/curation/filtered.jsonl";
writeFileSync(filtered, clean(readFileSync(filtered, "utf8")));

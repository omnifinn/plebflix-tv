import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { PROTECTED } from "../lib/curate.mjs";
import { checkYoutube, proveControl } from "../lib/playcheck.mjs";
import { validateChannel } from "../lib/schema.mjs";

const args = process.argv.slice(2);
const limit = Number(flag("--limit") || 0);
const pendingOnly = args.includes("--pending");
const recheck = args.includes("--recheck") || args.includes("--drop-dead");
const dropDead = args.includes("--drop-dead");
const ytdlp = process.env.YT_DLP || `${process.env.HOME}/.local/bin/yt-dlp`;

const channels = new Map();
for (const name of ["suomi", "international"]) {
  channels.set(name, JSON.parse(await readFile(`channels/${name}.json`, "utf8")));
}

/** @type {any[]} */
let candidates = [];
const file = flag("--file");
if ((!recheck && !pendingOnly) || file) {
  const names = file ? [file] : (await readdir("candidates").catch(() => [])).filter((name) => name.endsWith(".json"));
  for (const name of names) {
    const parsed = JSON.parse(await readFile(name.startsWith("candidates/") || name.startsWith("/") ? name : `candidates/${name}`, "utf8"));
    candidates.push(...(Array.isArray(parsed) ? parsed : parsed.items || []));
  }
}
if (pendingOnly) {
  candidates = [];
  for (const doc of channels.values()) {
    for (const item of doc.items) {
      if (item.status !== "pending") continue;
      candidates.push({ ...item, channel: doc.id, embedId: item.source === "youtube" ? item.embedId : undefined });
    }
  }
}

const taken = new Set();
for (const doc of channels.values()) {
  for (const item of doc.items) taken.add(`${item.source}:${item.embedId}`);
}

const resolved = [];
let seen = 0;
for (const candidate of candidates) {
  if (limit && seen >= limit) break;
  seen += 1;
  const row = await resolveCandidate(candidate);
  if (!row) continue;
  if (taken.has(`${row.source}:${row.embedId}`) && !pendingOnly) {
    process.stderr.write(`have ${row.embedId} ${row.title}\n`);
    continue;
  }
  resolved.push(row);
}

const recheckIds = [];
if (recheck) {
  for (const doc of channels.values()) {
    for (const item of doc.items) {
      if (item.source === "youtube" && item.status !== "pending" && item.duration > 0) recheckIds.push(item.embedId);
    }
  }
}

const ids = [...new Set([...resolved.map((row) => row.embedId), ...recheckIds])];
if (!ids.length && !recheckIds.length) {
  console.log("Nothing new to check.");
  process.exit(0);
}

let control;
try {
  control = await proveControl();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
console.error(`Control played (${control.duration}s).`);

const checked = new Map((await checkYoutube(ids.filter((id) => id !== "dQw4w9WgXcQ"))).map((row) => [row.id, row]));
checked.set("dQw4w9WgXcQ", control);
if ([...checked.values()].some((row) => row.code === "bot")) {
  console.error("YouTube asked the checker to sign in. The shelf was not changed.");
  process.exit(2);
}

let added = 0;
for (const row of resolved) {
  const result = checked.get(row.embedId);
  if (!result?.ok) {
    process.stderr.write(`reject ${row.embedId} ${row.title} ${result?.code || "missing"}\n`);
    continue;
  }
  const doc = channels.get(row.channel);
  if (!doc) continue;
  const duration = Math.round(result.duration);
  if (pendingOnly) {
    const item = doc.items.find((entry) => entry.embedId === row.embedId && entry.source === "youtube");
    if (!item) continue;
    item.duration = duration;
    delete item.status;
    added += 1;
    continue;
  }
  const item = {
    id: uniqueId(doc, slug(row.title)),
    title: row.title,
    year: row.year,
    source: "youtube",
    embedId: row.embedId,
    duration,
    note: row.note || row.why,
    signals: row.signals,
    why: row.why,
    original_url: row.original_url || `https://www.youtube.com/watch?v=${row.embedId}`,
  };
  if (row.creator) item.creator = row.creator;
  if (Array.isArray(row.tags) && row.tags.length) item.tags = row.tags;
  if (row.credit) item.credit = row.credit;
  doc.items.push(item);
  taken.add(`youtube:${row.embedId}`);
  added += 1;
}

let removed = 0;
if (dropDead) {
  for (const doc of channels.values()) {
    doc.items = doc.items.filter((item) => {
      if (item.source !== "youtube" || item.status === "pending" || PROTECTED.has(item.id)) return true;
      const result = checked.get(item.embedId);
      if (result && !result.ok) {
        removed += 1;
        process.stderr.write(`drop ${item.id} ${item.embedId} ${result.code}\n`);
        return false;
      }
      return true;
    });
  }
}

for (const [id, doc] of channels) {
  const check = validateChannel(doc, id);
  if (!check.ok) {
    console.error(check.errors.join("\n"));
    process.exit(1);
  }
  await writeFile(`channels/${id}.json`, `${JSON.stringify(doc, null, 2)}\n`);
}

console.log(`Added ${added}. Removed ${removed}. Run npm run resources.`);

/** @param {any} candidate */
async function resolveCandidate(candidate) {
  if (candidate.channel !== "suomi" && candidate.channel !== "international") return null;
  if (typeof candidate.year !== "number" || !Array.isArray(candidate.signals) || candidate.signals.length < 3) {
    process.stderr.write(`skip incomplete ${candidate.title || candidate.query}\n`);
    return null;
  }
  if (typeof candidate.embedId === "string" && /^[A-Za-z0-9_-]{6,32}$/.test(candidate.embedId)) {
    return {
      ...candidate,
      title: candidate.title || candidate.embedId,
      source: "youtube",
      why: candidate.why,
    };
  }
  if (typeof candidate.query !== "string") return null;
  const hit = await searchYoutube(candidate.query, candidate.match || candidate.title || "");
  if (!hit) {
    process.stderr.write(`no match ${candidate.query}\n`);
    return null;
  }
  return { ...candidate, title: candidate.title || hit.title, embedId: hit.id, source: "youtube" };
}

/**
 * @param {string} query
 * @param {string} match
 */
async function searchYoutube(query, match) {
  const pattern = new RegExp(match, "i");
  const text = await run(ytdlp, ["--flat-playlist", "--print", "%(id)s\t%(title)s", `ytsearch5:${query}`]);
  for (const line of text.split("\n")) {
    const [id, title] = line.split("\t");
    if (!id || !title) continue;
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) continue;
    if (pattern.test(title)) return { id, title: title.trim() };
  }
  return null;
}

/** @param {string} command @param {string[]} commandArgs */
function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

/** @param {{ items: Array<{ id: string }> }} doc @param {string} base */
function uniqueId(doc, base) {
  let id = base || "tape";
  let n = 2;
  const takenIds = new Set(doc.items.map((item) => item.id));
  while (takenIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** @param {string} title */
function slug(title) {
  const id = String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return id || "tape";
}

/** @param {string} name */
function flag(name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return "";
  return args[index + 1];
}

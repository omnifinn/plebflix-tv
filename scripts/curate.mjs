import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { globSync } from "node:fs";
import { dayKey } from "../public/schedule.js";
import { applyDrops, renderReport } from "../lib/curate.mjs";

const args = process.argv.slice(2);
const urlFlag = flag("--url");
const statsFlag = flag("--stats");
const day = flag("--day") || dayKey(Date.now());
const openPr = args.includes("--pr");

const channels = [];
for (const name of ["suomi", "international"]) {
  channels.push(JSON.parse(await readFile(`channels/${name}.json`, "utf8")));
}

const loaded = await loadStats(channels, day);
const report = renderReport(channels, loaded.stats, { day, note: loaded.note });
process.stdout.write(report.text);

const dropCount = report.plans.reduce((sum, entry) => sum + entry.plan.drops.length, 0);
if (!openPr) process.exit(0);
if (!dropCount) {
  console.error("No tapes to pull, so no pull request.");
  process.exit(0);
}
const token = (process.env.GITHUB_TOKEN || "").trim();
if (!token) {
  console.error("No GITHUB_TOKEN, so the report is the whole job. No pull request was opened.");
  process.exit(0);
}
const repo = (process.env.GITHUB_REPO || "omnifinn/plebflix-tv").trim();
try {
  const prUrl = await openRemovalPr(token, repo, report.plans);
  console.error(prUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/** @param {string} name */
function flag(name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return "";
  return args[index + 1];
}

/**
 * @param {Array<{ id: string }>} docs
 * @param {string} dayKeyValue
 */
async function loadStats(docs, dayKeyValue) {
  if (statsFlag) {
    const parsed = JSON.parse(await readFile(statsFlag, "utf8"));
    return { stats: parsed, note: `Stats file: ${statsFlag}.` };
  }
  const base = (urlFlag || process.env.PLEBFLIX_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  try {
    /** @type {Record<string, any>} */
    const stats = {};
    for (const doc of docs) {
      const response = await fetch(`${base}/api/stats?channel=${doc.id}&day=${dayKeyValue}`);
      if (!response.ok) throw new Error(`stats ${response.status}`);
      const body = await response.json();
      stats[doc.id] = body.items || {};
    }
    return { stats, note: `Stats from ${base}.` };
  } catch {
    const fromDisk = readLocalD1(docs, dayKeyValue);
    if (fromDisk) return fromDisk;
    return {
      stats: {},
      note: "The vote shelf was unreachable, so nothing is flagged. Start the set, pass --stats, or apply the local D1 migration.",
    };
  }
}

/**
 * @param {Array<{ id: string }>} docs
 * @param {string} dayKeyValue
 */
function readLocalD1(docs, dayKeyValue) {
  const files = globSync(".wrangler/state/**/*.sqlite").filter((file) => !file.endsWith("-shm") && !file.endsWith("-wal"));
  if (!files.length) return null;
  files.sort();
  const database = new DatabaseSync(files[files.length - 1], { readOnly: true });
  const before = `${dayKeyValue}T00:00:00.000Z`;
  /** @type {Record<string, Record<string, { up: number, down: number, impressions: number }>>} */
  const stats = {};
  for (const doc of docs) {
    /** @type {Record<string, { up: number, down: number, impressions: number }>} */
    const map = {};
    const votes = database
      .prepare(
        `SELECT item_id AS itemId,
                SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up,
                SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
           FROM votes WHERE channel = ? AND created_at < ? GROUP BY item_id`,
      )
      .all(doc.id, before);
    const plays = database
      .prepare(
        `SELECT item_id AS itemId, COUNT(*) AS impressions
           FROM impressions WHERE channel = ? AND created_at < ? GROUP BY item_id`,
      )
      .all(doc.id, before);
    for (const row of votes) {
      map[String(row.itemId)] = { up: Number(row.up) || 0, down: Number(row.down) || 0, impressions: 0 };
    }
    for (const row of plays) {
      const id = String(row.itemId);
      if (!map[id]) map[id] = { up: 0, down: 0, impressions: 0 };
      map[id].impressions = Number(row.impressions) || 0;
    }
    stats[doc.id] = map;
  }
  database.close();
  return { stats, note: `Stats from the local D1 file ${files[files.length - 1]}.` };
}

/**
 * @param {string} token
 * @param {string} repo
 * @param {Array<{ channel: { id: string }, plan: { drops: Array<{ id: string, title: string }> } }>} plans
 */
async function openRemovalPr(token, repo, plans) {
  const gh = github(token);
  const info = await gh(`/repos/${repo}`);
  const baseBranch = info.default_branch;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseSha = ref.object.sha;
  const commit = await gh(`/repos/${repo}/git/commits/${baseSha}`);
  const names = (await readdir("channels")).filter((name) => name.endsWith(".json") && name !== "categories.json").sort();
  const docs = [];
  for (const name of names) {
    const file = await gh(`/repos/${repo}/contents/channels/${name}?ref=${encodeURIComponent(baseBranch)}`);
    docs.push(JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8")));
  }
  const remotePlans = plans
    .map((entry) => ({
      channel: docs.find((doc) => doc.id === entry.channel.id) || entry.channel,
      plan: entry.plan,
    }))
    .filter((entry) => entry.channel?.items);
  const applied = applyDrops(docs, remotePlans);
  if (!applied.removed.length) throw new Error("Those tapes are not on the default branch.");
  const treeEntries = [];
  for (const doc of applied.docs) {
    const blob = await gh(`/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: `${JSON.stringify(doc, null, 2)}\n`, encoding: "utf-8" }),
    });
    treeEntries.push({ path: `channels/${doc.id}.json`, mode: "100644", type: "blob", sha: blob.sha });
  }
  const resourcesBlob = await gh(`/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: applied.resources, encoding: "utf-8" }),
  });
  treeEntries.push({ path: "RESOURCES.md", mode: "100644", type: "blob", sha: resourcesBlob.sha });
  const tree = await gh(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }),
  });
  const stamp = day.replaceAll("-", "");
  const next = await gh(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Pull ${applied.removed.length} low-scoring tapes\n\nOpened by npm run curate.`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });
  const branch = `curate/drop-${stamp}`;
  await gh(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: next.sha }),
  });
  const titles = plans.flatMap((entry) => entry.plan.drops.map((row) => `- ${row.title} (\`${row.id}\`)`));
  try {
    const pr = await gh(`/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `Pull ${applied.removed.length} low-scoring tapes`,
        head: branch,
        base: baseBranch,
        body: ["## Curation", "", "The room voted these off the loop.", "", ...titles, ""].join("\n"),
      }),
    });
    return pr.html_url;
  } catch (error) {
    await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

/** @param {string} token */
function github(token) {
  return async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "plebflix-tv",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (init.method === "DELETE" && (response.status === 204 || response.status === 404)) return null;
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new Error(payload?.message || response.statusText);
    return payload;
  };
}

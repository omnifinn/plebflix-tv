// npm run validate — the gate for every data edit under channels/ (Page's daily PRs run it in CI).
// Checks: each language shelf (channels/<lang>.json), categories.json against the shelves, schedule.json against
// both, and sources.json. Exit 1 on the first file that fails; every error is printed with its file and path.
import { readdir, readFile } from "node:fs/promises";
import { validateCategories, validateChannel, validateSchedule, validateSources } from "../lib/schema.mjs";

const META_FILES = new Set(["categories.json", "schedule.json"]);
const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && !META_FILES.has(name)).sort();
if (!files.length) {
  console.error("No channel files in channels/");
  process.exit(1);
}

let failed = false;
const report = (name, result, okLine) => {
  if (!result.ok) {
    failed = true;
    for (const error of result.errors) console.error(`${name}: ${error}`);
  } else console.log(`${name}: ${okLine}`);
};
const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failed = true;
    console.error(`${file}: ${error.message}`);
    return null;
  }
};

/** @type {Record<string, any>} */
const catalogs = {};
for (const name of files) {
  const expectedId = name.replace(/\.json$/, "");
  const doc = await readJson(`channels/${name}`);
  if (!doc) continue;
  const result = validateChannel(doc, expectedId);
  if (result.ok) {
    catalogs[expectedId] = doc;
    const live = doc.items.filter((item) => item.status !== "pending").length;
    const waiting = doc.items.filter((item) => typeof item.added === "string" && item.added >= new Date().toISOString().slice(0, 10)).length;
    report(name, result, `${live} on air, ${doc.items.length - live} pending${waiting ? `, ${waiting} airing from tomorrow` : ""}`);
  } else report(name, result, "");
}

const categories = await readJson("channels/categories.json");
if (categories) report("categories.json", validateCategories(categories, catalogs), `${categories.channels.length} categories, ${Object.keys(categories.assign).length} tapes assigned`);

const schedule = await readJson("channels/schedule.json");
if (schedule) {
  const blocks = Object.keys(schedule.channels || {});
  const slots = blocks.reduce((sum, id) => sum + (schedule.channels[id]?.slots?.length || 0), 0) + (schedule.defaults?.slots?.length || 0);
  report("schedule.json", validateSchedule(schedule, catalogs, categories || undefined), `${blocks.length} channel blocks, ${slots} fixed slots`);
}

const sources = await readJson("sources.json");
if (sources) report("sources.json", validateSources(sources), `${sources.shelves.length} shelves, ${sources.finds.length} finds`);

if (failed) process.exit(1);

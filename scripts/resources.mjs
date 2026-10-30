import { readFile, readdir, writeFile } from "node:fs/promises";
import { renderResources } from "../lib/resources-md.mjs";

// The shelves only: categories.json and schedule.json describe the channels, they hold no tapes.
const META_FILES = new Set(["categories.json", "schedule.json"]);
const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && !META_FILES.has(name)).sort();
const channels = [];
for (const name of files) {
  channels.push(JSON.parse(await readFile(`channels/${name}`, "utf8")));
}
const markdown = renderResources(channels);
if (process.argv.includes("--check")) {
  const current = await readFile("RESOURCES.md", "utf8");
  if (current !== markdown) {
    console.error("RESOURCES.md is out of date. Run npm run resources.");
    process.exit(1);
  }
  console.log("RESOURCES.md matches the channel files.");
} else {
  await writeFile("RESOURCES.md", markdown);
  console.log("Wrote RESOURCES.md");
}

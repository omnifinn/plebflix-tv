import { readFile, readdir, writeFile } from "node:fs/promises";
import { renderCredits, renderTakedown } from "../lib/credits-page.mjs";
import { renderResources } from "../lib/resources-md.mjs";

// The shelves only: categories.json and schedule.json describe the channels, they hold no tapes.
const META_FILES = new Set(["categories.json", "schedule.json"]);
const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && !META_FILES.has(name)).sort();
const channels = [];
for (const name of files) {
  channels.push(JSON.parse(await readFile(`channels/${name}`, "utf8")));
}
const markdown = renderResources(channels);
const credits = renderCredits(channels);
const takedown = renderTakedown();
if (process.argv.includes("--check")) {
  const current = await readFile("RESOURCES.md", "utf8");
  const creditsNow = await readFile("public/credits.html", "utf8");
  const takedownNow = await readFile("public/takedown.html", "utf8");
  let failed = false;
  if (current !== markdown) {
    console.error("RESOURCES.md is out of date. Run npm run resources.");
    failed = true;
  }
  if (creditsNow !== credits) {
    console.error("public/credits.html is out of date. Run npm run resources.");
    failed = true;
  }
  if (takedownNow !== takedown) {
    console.error("public/takedown.html is out of date. Run npm run resources.");
    failed = true;
  }
  if (failed) process.exit(1);
  console.log("RESOURCES.md, credits and takedown match the channel files.");
} else {
  await writeFile("RESOURCES.md", markdown);
  await writeFile("public/credits.html", credits);
  await writeFile("public/takedown.html", takedown);
  console.log("Wrote RESOURCES.md, public/credits.html and public/takedown.html");
}

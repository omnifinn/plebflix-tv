import { readdir, readFile } from "node:fs/promises";
import { validateChannel, validateSources } from "../lib/schema.mjs";

const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && name !== "categories.json").sort();
if (!files.length) {
  console.error("No channel files in channels/");
  process.exit(1);
}

let failed = false;
for (const name of files) {
  const expectedId = name.replace(/\.json$/, "");
  let doc;
  try {
    doc = JSON.parse(await readFile(`channels/${name}`, "utf8"));
  } catch (error) {
    failed = true;
    console.error(`${name}: ${error.message}`);
    continue;
  }
  const result = validateChannel(doc, expectedId);
  if (!result.ok) {
    failed = true;
    for (const error of result.errors) console.error(`${name}: ${error}`);
  } else {
    const live = doc.items.filter((item) => item.status !== "pending").length;
    console.log(`${name}: ${live} on air, ${doc.items.length - live} pending`);
  }
}

let sources;
try {
  sources = JSON.parse(await readFile("sources.json", "utf8"));
} catch (error) {
  failed = true;
  console.error(`sources.json: ${error.message}`);
}
if (sources) {
  const result = validateSources(sources);
  if (!result.ok) {
    failed = true;
    for (const error of result.errors) console.error(`sources.json: ${error}`);
  } else {
    console.log(`sources.json: ${sources.shelves.length} shelves, ${sources.finds.length} finds`);
  }
}

if (failed) process.exit(1);

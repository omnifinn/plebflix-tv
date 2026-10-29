import { readdir, readFile } from "node:fs/promises";

const files = (await readdir("channels")).filter((name) => name.endsWith(".json")).sort();
let failed = 0;
for (const name of files) {
  const doc = JSON.parse(await readFile(`channels/${name}`, "utf8"));
  for (const item of doc.items) {
    if (item.status === "pending") continue;
    const ok = await check(item);
    if (!ok) failed += 1;
  }
}
if (failed) {
  console.error(`${failed} embed(s) did not resolve`);
  process.exit(1);
}
console.log("Every on-air embed resolved.");

/** @param {any} item */
async function check(item) {
  try {
    if (item.source === "youtube") {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${item.embedId}`)}&format=json`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`youtube ${item.embedId} (${item.title}): HTTP ${response.status}`);
        return false;
      }
      return true;
    }
    if (item.source === "archive.org") {
      const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(item.embedId)}`);
      if (!response.ok) {
        console.error(`archive.org ${item.embedId}: HTTP ${response.status}`);
        return false;
      }
      const data = await response.json();
      if (!data.metadata) {
        console.error(`archive.org ${item.embedId}: no metadata`);
        return false;
      }
      return true;
    }
    if (item.source === "vimeo") {
      const response = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${item.embedId}`)}`,
      );
      if (!response.ok) {
        console.error(`vimeo ${item.embedId}: HTTP ${response.status}`);
        return false;
      }
      return true;
    }
    console.log(`skip ${item.source} ${item.embedId}`);
    return true;
  } catch (error) {
    console.error(`${item.source} ${item.embedId}: ${error.message}`);
    return false;
  }
}

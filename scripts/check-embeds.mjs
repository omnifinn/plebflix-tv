#!/usr/bin/env node
// Weekly check: every on-air tape has a source that still resolves. This checks the sources exist; npm run
// verify-all-play proves they play. Exit 1 when any tape has no live source: fix the data, not the player.
//   npm run check-embeds
// YouTube: oEmbed, then noembed. archive.org: the item and its file. Image: the file answers.
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { archiveFile, sources } from "../public/play.js";

const META = new Set(["categories.json", "schedule.json"]);

/**
 * @param {any} item
 * @param {typeof fetch} [fetchImpl]
 */
export async function checkTape(item, fetchImpl = fetch) {
  if (item?.status === "pending") return { ok: true, skipped: "pending" };
  const list = sources(item);
  const checked = [];
  for (const source of list) checked.push({ ...source, ...(await sourceAlive(source, fetchImpl)) });
  const live = checked.filter((source) => source.ok);
  return {
    ok: live.length > 0,
    id: item.id,
    sources: checked,
    onlyYoutube: live.length > 0 && live.every((source) => source.kind === "youtube"),
    detail: list.length ? checked.map((source) => `${source.kind}:${source.id} ${source.detail || "ok"}`).join("; ") : "no sources",
  };
}

/**
 * @param {{ kind: string, id: string, file: string }} source
 * @param {typeof fetch} fetchImpl
 */
async function sourceAlive(source, fetchImpl) {
  if (source.kind === "youtube") return youtubeAlive(source.id, fetchImpl);
  if (source.kind === "archive") return archiveAlive(source.id, source.file, fetchImpl);
  if (source.kind === "wayback") return imageAlive(archiveFile(source), fetchImpl);
  if (source.kind === "image") return imageAlive(source.id, fetchImpl);
  return { ok: false, detail: "unknown kind" };
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 */
async function imageAlive(url, fetchImpl) {
  try {
    // Two bytes prove the file answers. A video must not be downloaded to check it.
    const response = await fetchImpl(url, { headers: { range: "bytes=0-1" }, signal: AbortSignal.timeout(20000) });
    await response.body?.cancel();
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    return { ok: true, via: "fetch" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} id
 * @param {typeof fetch} fetchImpl
 */
async function youtubeAlive(id, fetchImpl) {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
  try {
    const response = await fetchImpl(oembed, { signal: AbortSignal.timeout(20000) });
    if (response.ok) return { ok: true, via: "oembed" };
  } catch {
    /* noembed is the fallback when oEmbed does not answer */
  }
  try {
    const response = await fetchImpl(`https://noembed.com/embed?url=${encodeURIComponent(watch)}`, {
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data && !data.error && (data.title || data.author_name)) return { ok: true, via: "noembed" };
    return { ok: false, detail: String(data.error || `HTTP ${response.status}`) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} id
 * @param {string} file
 * @param {typeof fetch} fetchImpl
 */
async function archiveAlive(id, file, fetchImpl) {
  try {
    const response = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const data = await response.json().catch(() => ({}));
    if (!data.metadata) return { ok: false, detail: "no metadata" };
    if (!(data.files || []).some((/** @type {{ name: string }} */ row) => row.name === file)) return { ok: false, detail: `no file ${file}` };
    return { ok: true, via: "metadata" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const names = (await readdir("channels")).filter((name) => name.endsWith(".json") && !META.has(name)).sort();
  let tapes = 0;
  const dead = [];
  const youtubeOnly = [];
  for (const name of names) {
    const doc = JSON.parse(await readFile(`channels/${name}`, "utf8"));
    for (const item of doc.items || []) {
      const result = await checkTape(item);
      if (result.skipped) continue;
      tapes += 1;
      if (!result.ok) {
        dead.push(`${doc.id}/${item.id}`);
        console.error(`NO PLAYABLE SOURCE ${doc.id}/${item.id}: ${result.detail}`);
      } else if (result.onlyYoutube) youtubeOnly.push(`${doc.id}/${item.id}`);
    }
  }
  if (youtubeOnly.length) console.log(`YouTube only, nothing else to play when YouTube refuses a viewer (${youtubeOnly.length}):\n  ${youtubeOnly.join("\n  ")}`);
  if (dead.length) {
    console.error(`${dead.length} of ${tapes} tapes have no playable source. Fix the data.`);
    process.exit(1);
  }
  console.log(`Every tape has a live source (${tapes} checked, ${youtubeOnly.length} YouTube only).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

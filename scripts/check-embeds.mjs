#!/usr/bin/env node
// Weekly check: every on-air embed still resolves. Link-only tapes have no embed and are listed, not failed.
//   npm run check-embeds
// YouTube: oEmbed, then noembed if oEmbed refuses. archive.org: metadata. Exit 1 when an embed is dead.
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { playback } from "../public/play.js";

const META = new Set(["categories.json", "schedule.json"]);

/**
 * @param {any} item
 * @param {typeof fetch} [fetchImpl]
 */
export async function checkTape(item, fetchImpl = fetch) {
  if (item?.status === "pending") return { ok: true, skipped: "pending" };
  const play = playback(item);
  if (play.kind === "link") return { ok: true, kind: "link", id: item.id, play };
  if (play.kind === "youtube") return { ...(await youtubeAlive(play.id, fetchImpl)), kind: "youtube", id: item.id, play };
  if (play.kind === "archive") return { ...(await archiveAlive(play.id, fetchImpl)), kind: "archive", id: item.id, play };
  return { ok: false, kind: play.kind, id: item.id, play, detail: "unknown play kind" };
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
 * @param {typeof fetch} fetchImpl
 */
async function archiveAlive(id, fetchImpl) {
  try {
    const response = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const data = await response.json().catch(() => ({}));
    if (!data.metadata) return { ok: false, detail: "no metadata" };
    return { ok: true, via: "metadata" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const names = (await readdir("channels")).filter((name) => name.endsWith(".json") && !META.has(name)).sort();
  /** @type {Array<{ channel: string, title: string, result: any }>} */
  const dead = [];
  /** @type {Array<{ channel: string, id: string, title: string, url: string }>} */
  const links = [];
  let embeds = 0;
  for (const name of names) {
    const doc = JSON.parse(await readFile(`channels/${name}`, "utf8"));
    for (const item of doc.items || []) {
      const result = await checkTape(item);
      if (result.skipped) continue;
      if (result.kind === "link") {
        links.push({ channel: doc.id, id: item.id, title: item.title, url: result.play?.id || "" });
        continue;
      }
      embeds += 1;
      if (!result.ok) {
        dead.push({ channel: doc.id, title: item.title, result });
        console.error(`DEAD ${doc.id}/${item.id} ${result.kind} ${result.play?.id || ""} ${result.detail || ""}`);
      }
    }
  }
  if (links.length) {
    console.log(`link-only (${links.length}), no embed to check:`);
    for (const row of links) console.log(`  ${row.channel}/${row.id} ${row.url}`);
  }
  if (dead.length) {
    console.error(`${dead.length} embed(s) did not resolve (${embeds} checked).`);
    process.exit(1);
  }
  console.log(`Every on-air embed resolved (${embeds} checked, ${links.length} link-only).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

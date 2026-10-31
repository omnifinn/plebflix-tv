#!/usr/bin/env node
// Proves every tape plays in the real player, one tape at a time, in a real browser.
//   npm run verify-all-play
//   npm run verify-all-play -- --url http://localhost:8799 --browsers chrome,webkit --only numa-numa,doge --concurrency 4
// The page is the real site with its shelves narrowed to the one tape, so the real source order and player run.
// PLAYING means: YouTube reports state 1 with time moving, the Internet Archive stream's clock is moving, or the still has
// loaded. Writes dist/verify-all-play.<browser>.json. Exit 0 only when every tape is PLAYING in every browser.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const base = String(arg("url", "https://plebflix.com")).replace(/\/$/, "");
const browsers = String(arg("browsers", "chrome,webkit")).split(",");
const only = arg("only", "") ? new Set(String(arg("only", "")).split(",")) : null;
const workers = Number(arg("concurrency", 4));
const budgetMs = Number(arg("timeout", 40000));
const META = new Set(["categories.json", "schedule.json", "index.json"]);

const tapes = [];
for (const name of readdirSync("channels").filter((file) => file.endsWith(".json") && !META.has(file)).sort()) {
  const doc = JSON.parse(readFileSync(`channels/${name}`, "utf8"));
  for (const item of doc.items || []) {
    if (item.status === "pending") continue;
    if (!only || only.has(item.id)) tapes.push({ ...item, channel: doc.id });
  }
}

const HOOK = () => {
  window.__yt = { last: null, times: [] };
  window.addEventListener("message", (event) => {
    if (!/youtube/.test(event.origin)) return;
    let data = event.data;
    try {
      if (typeof data === "string") data = JSON.parse(data);
    } catch {
      return;
    }
    const info = data?.info;
    if (!info || typeof info !== "object") return;
    if (typeof info.playerState === "number") window.__yt.last = info.playerState;
    if (typeof info.currentTime === "number") window.__yt.times.push(info.currentTime);
  });
};

function launch(name) {
  if (name === "chrome") return chromium.launch({ channel: "chrome", headless: true });
  if (name === "webkit") return webkit.launch({ headless: true });
  throw new Error(`unknown browser ${name}`);
}

async function proveTape(browser, tape) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const notes = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[plebflix]")) notes.push(message.text().slice(11, 120));
  });
  await page.addInitScript(HOOK);
  await page.route(/\/channels\/[^/]+\.json/, async (route) => {
    const response = await route.fetch();
    const doc = await response.json();
    if (Array.isArray(doc.items)) {
      // Long enough that the clock is always inside the tape, never on the end of a short one.
      doc.items = [{ ...tape, added: undefined, duration: Math.max(tape.duration, 60) }];
    }
    await route.fulfill({ response, json: doc });
  });
  const path = tape.channel === "suomi" ? "/suomi" : "/";
  const result = { id: tape.id, channel: tape.channel, status: "FAILED", source: "", notes };
  try {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => {
        const source = document.querySelector("#stage")?.dataset.source || "";
        const vid = document.querySelector("#vid");
        const poster = document.querySelector("#poster");
        const times = window.__yt.times.slice(-6);
        return {
          source,
          youtube: window.__yt.last === 1 && times.length > 1 && times[times.length - 1] > times[0],
          // An audio-only capture has a moving clock and an empty picture. That is not playing.
          clock: vid && !vid.hidden && !vid.paused && vid.videoWidth > 0 ? vid.currentTime : -1,
          still: Boolean(poster && !poster.hidden && poster.naturalWidth > 0),
          box: document.querySelector("#vid:not([hidden]), iframe#yt, #poster:not([hidden])")?.getBoundingClientRect().width || 0,
        };
      });
      result.source = state.source;
      if (state.source === "none") break;
      const kind = state.source.split(":")[0];
      if (kind === "youtube" && state.youtube && state.box > 0) result.status = "PLAYING";
      if (kind === "image" && state.still && state.box > 0) result.status = "PLAYING";
      if ((kind === "archive" || kind === "wayback") && state.clock >= 0 && state.box > 0) {
        const before = state.clock;
        await page.waitForTimeout(2000);
        const after = await page.evaluate(() => {
          const vid = document.querySelector("#vid");
          // Chrome counts decoded audio even while muted. WebKit exposes its tracks. A capture with no sound is a failure.
          const audio = vid.webkitAudioDecodedByteCount ?? -1;
          const tracks = vid.audioTracks?.length ?? -1;
          return { time: vid.currentTime, sound: audio > 0 || tracks > 0 };
        });
        if (after.time > before && after.sound) result.status = "PLAYING";
        else if (after.time > before) notes.push("picture but no sound");
      }
      if (result.status === "PLAYING") break;
    }
  } catch (error) {
    notes.push(String(error).slice(0, 160));
  }
  await context.close();
  return result;
}

let failures = 0;
mkdirSync("dist", { recursive: true });
for (const name of browsers) {
  const browser = await launch(name);
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < tapes.length) {
        const tape = tapes[cursor];
        cursor += 1;
        const result = await proveTape(browser, tape);
        results.push(result);
        console.log(`${result.status} ${name} ${tape.channel}/${tape.id} ${result.source}${result.status === "PLAYING" ? "" : ` ${result.notes.join("; ")}`}`);
      }
    }),
  );
  await browser.close();
  writeFileSync(`dist/verify-all-play.${name}.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((row) => row.status !== "PLAYING");
  failures += failed.length;
  console.log(`\n${name}: ${results.length - failed.length}/${results.length} PLAYING`);
  if (failed.length) console.log(`${name} failures:\n${failed.map((row) => `  ${row.channel}/${row.id}`).sort().join("\n")}`);
}
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
// Live-schedule playback proof: the real page, whatever is on air now, in Chrome and WebKit.
//   npm run smoke
//   npm run smoke -- --url http://localhost:8787 --browsers chrome --paths /suomi --timeout 45000 --headed
// PLAYING means YouTube reports state 1 with time moving, the archive.org stream's clock is moving, or a still loaded.
// Exit 0 only when every page plays. npm run verify-all-play is the per-tape proof.
import { chromium, webkit } from "playwright";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const base = String(arg("url", "https://plebflix.com")).replace(/\/$/, "");
const browsers = String(arg("browsers", "chrome,webkit")).split(",");
const paths = String(arg("paths", "/,/suomi")).split(",");
const budgetMs = Number(arg("timeout", 45000));
const headed = process.argv.includes("--headed");

const HOOK = () => {
  // The IFrame API posts its state to the embedding page. Reading those messages needs no change to the app.
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
  if (name === "chrome") return chromium.launch({ channel: "chrome", headless: !headed });
  if (name === "webkit") return webkit.launch({ headless: !headed });
  throw new Error(`unknown browser ${name}`);
}

async function probe(browser, path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const titles = new Set();
  await page.addInitScript(HOOK);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + budgetMs;
  let state = {};
  let status = "FAILED";
  let clock = -1;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    state = await page.evaluate(() => {
      const box = document.querySelector("#vid:not([hidden]), iframe#yt, #poster:not([hidden])")?.getBoundingClientRect();
      const vid = document.querySelector("#vid");
      const times = window.__yt.times.slice(-6);
      return {
        title: document.title,
        live: document.querySelector(".osd__live")?.dataset.state,
        source: document.querySelector("#stage")?.dataset.source || "",
        visible: Boolean(box && box.width > 0 && box.height > 0),
        youtube: window.__yt.last === 1 && times.length > 1 && times[times.length - 1] > times[0],
        clock: vid && !vid.hidden && !vid.paused ? vid.currentTime : -1,
        still: Boolean(document.querySelector("#poster")?.naturalWidth),
      };
    });
    titles.add(state.title);
    const kind = state.source.split(":")[0];
    if (state.visible && ((kind === "youtube" && state.youtube) || ((kind === "archive" || kind === "wayback") && state.clock > clock && clock >= 0) || (kind === "image" && state.still))) {
      status = "PLAYING";
      break;
    }
    clock = state.clock;
    if (kind === "none") {
      status = "NOSIGNAL";
      break;
    }
  }
  await context.close();
  // One schedule boundary can fall inside the run. More than that means the page is skipping tapes.
  if (titles.size > 2) status = "CASCADE";
  return { ...state, status, titles: [...titles] };
}

let broken = 0;
for (const name of browsers) {
  const browser = await launch(name);
  for (const path of paths) {
    const r = await probe(browser, path);
    if (r.status !== "PLAYING") broken += 1;
    console.log(`${r.status.padEnd(8)} ${name} ${base}${path} ${r.source} schedule=${r.live} "${r.title}"`);
    if (r.status !== "PLAYING") console.log(JSON.stringify(r));
  }
  await browser.close();
}
if (broken) {
  console.error(`smoke: ${broken} broken`);
  process.exit(1);
}
console.log("smoke: all playing");

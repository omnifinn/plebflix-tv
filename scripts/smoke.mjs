#!/usr/bin/env node
// Real-browser playback proof. A tape counts only when the YouTube player itself reports PLAYING with time moving.
//   npm run smoke                                   https://plebflix.com, / and /suomi, Chrome and WebKit
//   npm run smoke -- --url http://localhost:8787 --browsers chrome --paths /suomi --timeout 45000 --headed
// Each page runs twice:
//   tapes    the real schedule. PLAYING, or LINKOUT when YouTube refuses this network or tape.
//   control  our player with one known-good upload on every slot, so a refusal cannot hide a broken player.
// Exit 0: everything played. Exit 3: the player works, but real tapes were refused from this network, so this run
// says nothing about other viewers. Exit 1: broken.
import { chromium, webkit } from "playwright";

const CONTROL_ID = "dQw4w9WgXcQ";
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

/** Every slot becomes the control upload. Durations shrink so no scheduled offset falls past its end. */
async function useControl(page) {
  await page.route(/\/channels\/[^/]+\.json/, async (route) => {
    const response = await route.fetch();
    const doc = await response.json();
    if (Array.isArray(doc.items)) {
      for (const item of doc.items) {
        item.source = "youtube";
        item.embedId = CONTROL_ID;
        item.play = { kind: "youtube", id_or_url: CONTROL_ID, official: true, uploader: "control" };
        item.duration = 200;
      }
    }
    await route.fulfill({ response, json: doc });
  });
}

async function probe(browser, path, control) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const titles = new Set();
  let walled = false;
  await page.addInitScript(HOOK);
  if (control) await useControl(page);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + budgetMs;
  let state = {};
  let status = "FAILED";
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    for (const frame of page.frames()) {
      if (!/youtube/.test(frame.url())) continue;
      const text = await frame.evaluate(() => document.body?.innerText.slice(0, 400) || "").catch(() => "");
      if (/not a bot|sign in to confirm/i.test(text)) walled = true;
    }
    state = await page.evaluate(() => {
      const box = document.querySelector("iframe#yt")?.getBoundingClientRect();
      const link = document.querySelector("#card-link");
      const times = window.__yt.times.slice(-6);
      return {
        title: document.title,
        live: document.querySelector(".osd__live")?.dataset.state,
        frame: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "",
        visible: Boolean(box && box.width > 0 && box.height > 0),
        ytState: window.__yt.last,
        moving: times.length > 1 && times[times.length - 1] > times[0],
        at: Math.round(times[times.length - 1] || 0),
        link: link && !link.hidden ? link.href : "",
      };
    });
    titles.add(state.title);
    if (state.ytState === 1 && state.moving && state.visible) {
      status = "PLAYING";
      break;
    }
    if (state.link) {
      // Hold on the card past YouTube's retry window: a cascade would change the tape while we watch.
      await page.waitForTimeout(6000);
      titles.add(await page.title());
      status = "LINKOUT";
      break;
    }
  }
  await context.close();
  // One schedule boundary can fall inside the run. More than that means the page is skipping tapes.
  if (titles.size > 2) status = "CASCADE";
  return { ...state, status, walled, titles: [...titles] };
}

let broken = 0;
let refused = 0;
for (const name of browsers) {
  const browser = await launch(name);
  for (const path of paths) {
    for (const control of [false, true]) {
      const r = await probe(browser, path, control);
      const ok = r.status === "PLAYING" || (!control && r.status === "LINKOUT" && r.live === "live");
      if (!ok) broken += 1;
      else if (r.status === "LINKOUT") refused += 1;
      const why = r.status === "LINKOUT" ? ` ${r.walled ? "bot-wall" : "refused"} link=${r.link}` : "";
      console.log(`${r.status.padEnd(7)} ${name} ${control ? "control" : "tapes  "} ${base}${path} ${r.frame || "no-frame"} t=${r.at}s schedule=${r.live} "${r.title}"${why}`);
      if (!ok) console.log(JSON.stringify(r));
    }
  }
  await browser.close();
}
if (broken) {
  console.error(`smoke: ${broken} broken`);
  process.exit(1);
}
if (refused) {
  console.error(`smoke: player works; ${refused} real-tape run(s) refused by YouTube from this network, so nothing is proven for other viewers`);
  process.exit(3);
}
console.log("smoke: all playing");

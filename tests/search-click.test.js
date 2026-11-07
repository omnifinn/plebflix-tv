import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

/**
 * The real IFrame API's loadVideoById does not rewrite iframe.src. A ready player keeps the previous
 * embed URL while it plays the new id, so a wait on that URL fails on a machine where YouTube is up
 * and passes on one where error 150 destroys the frame first. This stand-in is the player the page
 * actually calls. It records the load and mirrors the requested id into the frame it owns.
 * Real playback stays npm run smoke.
 */
const PLAYER = `
window.__ytLoads = [];
window.YT = window.YT || {};
window.YT.PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
window.YT.Player = function Player(el, opts) {
  const node = typeof el === "string" ? document.getElementById(el) : el;
  const iframe = document.createElement("iframe");
  iframe.id = (node && node.id) || "yt";
  const host = opts.host || "https://www.youtube-nocookie.com";
  const note = (op, videoId, start) => {
    window.__ytLoads.push({ op: op, videoId: videoId, host: host, id: iframe.id, start: Number(start) || 0 });
    iframe.src = host + "/embed/" + videoId + "?start=" + (Number(start) || 0);
  };
  note("new", opts.videoId, opts.playerVars && opts.playerVars.start);
  this.iframe = iframe;
  this.ytHost = host;
  if (node && node.parentNode) node.replaceWith(iframe);
  const playing = () => {
    if (opts.events && opts.events.onStateChange) opts.events.onStateChange({ target: this, data: window.YT.PlayerState.PLAYING });
  };
  this.loadVideoById = (arg) => {
    note("load", arg && arg.videoId ? arg.videoId : arg, arg && arg.startSeconds);
    queueMicrotask(playing);
  };
  this.destroy = () => iframe.remove();
  this.mute = function () {};
  this.unMute = function () {};
  this.setVolume = function () {};
  this.playVideo = function () {};
  this.pauseVideo = function () {};
  this.seekTo = function () {};
  this.getPlayerState = () => window.YT.PlayerState.PLAYING;
  queueMicrotask(() => {
    if (opts.events && opts.events.onReady) opts.events.onReady({ target: this });
    playing();
  });
};
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

function start() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const rel = pathname.replace(/^\/+/, "");
      if (!rel || rel.includes("..")) {
        res.writeHead(400);
        res.end("bad");
        return;
      }
      for (const file of [join(ROOT, "public", rel), join(ROOT, rel)]) {
        if (!file.startsWith(ROOT)) continue;
        try {
          const body = await readFile(file);
          res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
          res.end(body);
          return;
        } catch {
          /* the other root */
        }
      }
      res.writeHead(404);
      res.end("missing");
    } catch {
      res.writeHead(500);
      res.end("err");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function installPlayer(context) {
  await context.route(/youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com/, (route) => {
    if (route.request().url().includes("/iframe_api")) {
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: PLAYER });
    }
    return route.abort();
  });
}

/** GO LIVE is the deck key on a desktop and the lamp on a phone. */
async function clickLive(page) {
  const button = page.locator("#btn-live");
  if (await button.isVisible()) await button.click();
  else await page.locator("button.lamp").first().click();
}

/** The load the on-screen player was last asked for. Preload uses iframe#yt-next and does not count. */
async function onScreenLoad(page) {
  return page.evaluate(() => {
    const loads = window.__ytLoads || [];
    return loads.filter((row) => row.id === "yt").at(-1) || null;
  });
}

async function pick(page, query, id) {
  await page.fill("#search-q", query);
  await page.waitForSelector(`#search-list [data-id='${id}']`);
  await page.click(`#search-list [data-id='${id}']`);
  return page.evaluate((tape) => window.plebflix.state().spot?.item?.id === tape, id);
}

async function expectPick(page, { id, embed, channel }) {
  try {
    await page.waitForFunction(({ id: tape, embed: video, channel: cid }) => {
      const state = window.plebflix.state();
      const spot = state.spot;
      if (state.channelId !== cid || spot?.item?.id !== tape || spot.item.embedId !== video || spot.demand !== true || spot.offset >= 2 || state.mode !== "timeshift") return false;
      const first = spot.item.play?.[0]?.kind || spot.item.source;
      if (first === "youtube") {
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return load?.videoId === video && load.start === 0;
      }
      const src = document.querySelector("video")?.getAttribute("src") || "";
      return src.includes(video);
    }, { id, embed, channel }, { timeout: 3000 });
  } catch (error) {
    const dump = await page.evaluate(() => ({
      id: window.plebflix.state().spot?.item?.id,
      mode: window.plebflix.state().mode,
      demand: window.plebflix.state().spot?.demand,
      offset: window.plebflix.state().spot?.offset,
      loads: (window.__ytLoads || []).filter((row) => row.id === "yt").slice(-3),
      video: document.querySelector("video")?.getAttribute("src") || "",
      note: document.querySelector(".search__none")?.textContent || "",
    }));
    throw new Error(`${id} ${JSON.stringify(dump)} ${error.message}`);
  }
  const got = await page.evaluate(() => {
    const state = window.plebflix.state();
    const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
    return {
      channel: state.channelId,
      body: document.body.dataset.channel,
      ch: document.body.dataset.ch,
      id: state.spot.item.id,
      embed: state.spot.item.embedId,
      offset: state.spot.offset,
      mode: state.mode,
      shift: state.shift,
      demand: state.spot.demand,
      saved: localStorage.getItem("plebflix-channel"),
      note: document.querySelector(".search__none")?.textContent || "",
      hidden: document.querySelector("#search-list").hidden,
      query: document.querySelector("#search-q").value,
      load,
      src: document.querySelector("iframe#yt")?.src || "",
      video: document.querySelector("video")?.getAttribute("src") || "",
      playKind: state.spot.item.play?.[0]?.kind || "",
      source: state.spot.item.source || "",
    };
  });
  assert.equal(got.channel, channel);
  assert.equal(got.body, channel);
  assert.equal(got.ch, channel);
  assert.equal(got.id, id);
  assert.equal(got.embed, embed);
  assert.equal(got.mode, "timeshift");
  assert.equal(got.shift, "skip");
  assert.equal(got.demand, true);
  assert.equal(got.saved, channel);
  assert.equal(got.note, "");
  assert.equal(got.hidden, true);
  assert.equal(got.query, "");
  const first = got.playKind || got.source;
  if (first === "youtube") {
    assert.equal(got.load.op === "load" || got.load.op === "new", true);
    assert.equal(got.load.videoId, embed);
    assert.equal(got.load.start, 0);
    assert.match(got.load.host, /youtube/);
    assert.match(got.src, new RegExp(`/embed/${embed}\\?start=0`));
  } else {
    assert.match(got.video, new RegExp(embed));
  }
  assert.ok(got.offset < 2, `offset ${got.offset}`);
  return got;
}

test("a search click plays the chosen tape from the start, including one filed today", { timeout: 120000 }, async (t) => {
  const { chromium } = await import("playwright");
  let browser;
  let server;
  let context;
  try {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    server = await start();
    const base = `http://127.0.0.1:${server.address().port}/`;
    await mkdir("/opt/cursor/artifacts", { recursive: true });
    const shots = [];
    for (const viewport of [
      { name: "desktop", width: 1280, height: 800, mobile: false },
      { name: "phone", width: 390, height: 844, mobile: true },
    ]) {
      context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      await installPlayer(context);
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (!localStorage.getItem("plebflix-channel")) localStorage.setItem("plebflix-channel", "suomi");
      });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.plebflix?.state && window.plebflix.catalog && Array.isArray(window.__ytLoads), { timeout: 20000 });
      await page.waitForFunction(() => window.plebflix.state().spot?.item?.id, { timeout: 20000 });
      const before = await page.evaluate(() => {
        const item = window.plebflix.catalog().flatMap((ch) => ch.items).find((entry) => entry.id === "like-a-boss");
        return { added: item.added, embed: item.embedId, today: new Date().toISOString().slice(0, 10) };
      });
      assert.equal(before.added, "2026-11-07");
      assert.equal(before.embed, "vH-KXk8PZc8");
      assert.equal(await pick(page, "like a boss", "like-a-boss"), true);
      const held = await expectPick(page, { id: "like-a-boss", embed: "vH-KXk8PZc8", channel: "international" });
      await page.waitForTimeout(700);
      const ticked = await page.evaluate(() => window.plebflix.state());
      assert.equal(ticked.spot.item.id, "like-a-boss");
      assert.equal(ticked.spot.item.embedId, "vH-KXk8PZc8");
      assert.equal(ticked.spot.demand, true);
      assert.equal(ticked.channelId, "international");
      assert.ok(ticked.spot.offset < 147);
      const lastLoad = await onScreenLoad(page);
      assert.equal(lastLoad.videoId, "vH-KXk8PZc8");
      assert.equal(lastLoad.start, 0);
      const beforeFwd = ticked.spot.offset;
      await page.locator("#btn-fwd").press("Enter");
      const forwarded = await page.evaluate(() => window.plebflix.state());
      assert.equal(forwarded.spot.item.id, "like-a-boss");
      assert.equal(forwarded.spot.item.embedId, "vH-KXk8PZc8");
      assert.equal(forwarded.spot.demand, true);
      assert.equal(forwarded.shift, "seek");
      assert.ok(forwarded.spot.offset >= beforeFwd + 10, `fwd offset ${forwarded.spot.offset}`);
      await page.click("#btn-pause");
      const paused = await page.evaluate(() => window.plebflix.state());
      assert.equal(paused.mode, "paused");
      assert.equal(paused.spot.item.id, "like-a-boss");
      const heldOffset = paused.spot.offset;
      await page.waitForTimeout(400);
      const pausedStill = await page.evaluate(() => window.plebflix.state());
      assert.equal(pausedStill.mode, "paused");
      assert.equal(pausedStill.spot.item.id, "like-a-boss");
      assert.ok(Math.abs(pausedStill.spot.offset - heldOffset) < 0.01);
      await page.click("#btn-pause");
      await page.waitForFunction(() => window.plebflix.state().mode === "timeshift" && window.plebflix.state().spot.item.id === "like-a-boss");
      await page.evaluate(() => window.plebflix.debugDemandAt(12));
      const playBox = await page.evaluate(() => {
        const button = document.querySelector("#btn-play");
        const style = getComputedStyle(button);
        return { w: innerWidth, display: style.display, hidden: button.hidden };
      });
      if (playBox.display === "none") await page.evaluate(() => document.querySelector("#btn-play").click());
      else await page.click("#btn-play");
      await page.waitForFunction(() => window.plebflix.state().spot.item.id === "like-a-boss" && window.plebflix.state().spot.offset < 2);
      const replay = await onScreenLoad(page);
      assert.equal(replay.videoId, "vH-KXk8PZc8");
      assert.equal(replay.start, 0);
      await page.evaluate(() => window.plebflix.debugDemandAt(12));
      await page.click("#btn-prev");
      await page.waitForFunction(() => window.plebflix.state().spot.item.id === "like-a-boss" && window.plebflix.state().spot.offset < 2);
      await page.evaluate(() => window.plebSkins.set("neon"));
      const skinned = await page.evaluate(() => ({ id: window.plebflix.state().spot.item.id, demand: window.plebflix.state().spot.demand, skin: document.documentElement.dataset.skin }));
      assert.equal(skinned.id, "like-a-boss");
      assert.equal(skinned.demand, true);
      assert.equal(skinned.skin, "neon");
      const skew = Date.parse("2026-11-08T00:00:05.000Z") - Date.now();
      await page.evaluate((ms) => window.plebflix.debugClock(ms), skew);
      await page.waitForTimeout(500);
      const midnight = await page.evaluate(() => window.plebflix.state());
      assert.equal(midnight.spot.item.id, "like-a-boss");
      assert.equal(midnight.spot.item.embedId, "vH-KXk8PZc8");
      assert.equal(midnight.spot.demand, true);
      assert.equal(midnight.channelId, "international");
      await page.evaluate(() => window.plebflix.debugClock(0));
      await page.evaluate(() => window.plebflix.debugDemandAt(147));
      await page.waitForFunction(() => {
        const state = window.plebflix.state();
        return state.mode === "timeshift" && state.shift === "skip" && state.spot?.demand !== true && state.spot?.item?.id !== "like-a-boss";
      }, { timeout: 3000 });
      await clickLive(page);
      await page.waitForFunction(() => window.plebflix.state().mode === "live" && window.plebflix.state().shift === "");
      const returned = await page.evaluate(() => window.plebflix.state());
      assert.notEqual(returned.spot.demand, true);
      await page.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-held.png` });
      shots.push({ viewport: viewport.name, held, today: before.today });

      await pick(page, "numa numa", "numa-numa");
      const numa = await expectPick(page, { id: "numa-numa", embed: "Cqd1Gvq-RBY", channel: "international" });
      await page.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-numa.png` });

      await pick(page, "b5mies", "b5mies");
      const suomi = await expectPick(page, { id: "b5mies", embed: "f-lnF5eNFFY", channel: "suomi" });
      assert.equal(suomi.load.op, "load");

      await pick(page, "mongodb", "mongodb-web-scale");
      const older = await expectPick(page, { id: "mongodb-web-scale", embed: "b2F-DItXtZs", channel: "international" });

      await pick(page, "like a boss", "like-a-boss");
      await expectPick(page, { id: "like-a-boss", embed: "vH-KXk8PZc8", channel: "international" });
      await page.click("#tv-switch [data-lang='suomi']");
      await page.waitForFunction(() => {
        const state = window.plebflix.state();
        return state.channelId === "suomi" && state.mode === "live" && state.spot?.demand !== true && state.spot?.item?.id !== "like-a-boss";
      }, { timeout: 3000 });
      const switched = await page.evaluate(() => {
        const item = window.plebflix.state().spot.item;
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return { first: item.play?.[0]?.kind || item.source, embed: item.embedId, load: load?.videoId || "" };
      });
      if (switched.first === "youtube") assert.equal(switched.load, switched.embed);

      const missing = await page.evaluate(() => {
        const beforeId = window.plebflix.state().spot.item.id;
        return { played: window.plebflix.playTape("not-a-real-tape"), beforeId, afterId: window.plebflix.state().spot.item.id, note: window.plebflix.tapeNotice("not-a-real-tape") };
      });
      assert.equal(missing.played, false);
      assert.equal(missing.afterId, missing.beforeId);
      assert.equal(missing.note, "That tape is not on the shelf.");
      shots[shots.length - 1].numa = { id: numa.id, start: numa.load.start };
      shots[shots.length - 1].older = { id: older.id, start: older.load.start };
      shots[shots.length - 1].suomi = { id: suomi.id, op: suomi.load.op, start: suomi.load.start };
      await context.close();

      context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      await installPlayer(context);
      const intl = await context.newPage();
      await intl.addInitScript(() => {
        if (!localStorage.getItem("plebflix-channel")) localStorage.setItem("plebflix-channel", "international");
      });
      await intl.goto(base, { waitUntil: "domcontentloaded" });
      await intl.waitForFunction(() => window.plebflix?.state && window.plebflix.catalog && Array.isArray(window.__ytLoads), { timeout: 20000 });
      await intl.waitForFunction(() => window.plebflix.state().spot?.item?.id, { timeout: 20000 });
      await pick(intl, "like a boss", "like-a-boss");
      await expectPick(intl, { id: "like-a-boss", embed: "vH-KXk8PZc8", channel: "international" });
      await intl.click("#btn-next");
      await intl.waitForFunction(() => {
        const state = window.plebflix.state();
        return state.mode === "timeshift" && state.shift === "skip" && state.spot?.demand !== true && state.spot?.item?.id !== "like-a-boss";
      }, { timeout: 3000 });
      await pick(intl, "like a boss", "like-a-boss");
      const intlHeld = await expectPick(intl, { id: "like-a-boss", embed: "vH-KXk8PZc8", channel: "international" });
      await intl.waitForTimeout(500);
      const intlTick = await intl.evaluate(() => window.plebflix.state());
      assert.equal(intlTick.spot.item.id, "like-a-boss");
      assert.equal(intlTick.spot.demand, true);
      assert.equal(intlTick.channelId, "international");
      await intl.click("#btn-pause");
      const intlPaused = await intl.evaluate(() => window.plebflix.state());
      assert.equal(intlPaused.mode, "paused");
      assert.equal(intlPaused.spot.item.id, "like-a-boss");
      await clickLive(intl);
      await intl.waitForFunction(() => window.plebflix.state().mode === "live" && window.plebflix.state().spot?.demand !== true);
      await intl.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-held-intl.png` });
      shots[shots.length - 1].intlHeld = { id: intlHeld.id, start: intlHeld.load.start };
      await context.close();
      context = null;
    }
    await mkdir("/tmp/search-click", { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile("/tmp/search-click/result.json", JSON.stringify(shots, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    if (!browser) return t.skip(`browser unavailable: ${message}`);
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

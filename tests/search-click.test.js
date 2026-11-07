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
  const note = (op, videoId) => {
    window.__ytLoads.push({ op: op, videoId: videoId, host: host, id: iframe.id });
    iframe.src = host + "/embed/" + videoId;
  };
  note("new", opts.videoId);
  this.iframe = iframe;
  this.ytHost = host;
  if (node && node.parentNode) node.replaceWith(iframe);
  const playing = () => {
    if (opts.events && opts.events.onStateChange) opts.events.onStateChange({ target: this, data: window.YT.PlayerState.PLAYING });
  };
  this.loadVideoById = (arg) => {
    note("load", arg && arg.videoId ? arg.videoId : arg);
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

/** The load the on-screen player was last asked for. Preload uses iframe#yt-next and does not count. */
async function onScreenLoad(page) {
  return page.evaluate(() => {
    const loads = window.__ytLoads || [];
    return loads.filter((row) => row.id === "yt").at(-1) || null;
  });
}

test("a search click plays the chosen tape and channel, and a future tape stays put", { timeout: 90000 }, async (t) => {
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
        const spot = window.plebflix.state();
        const item = window.plebflix.catalog().flatMap((ch) => ch.items).find((entry) => entry.id === "like-a-boss");
        const today = new Date().toISOString().slice(0, 10);
        return { channel: spot.channelId, tape: spot.spot.item.id, added: item.added, embed: item.embedId, today, saved: localStorage.getItem("plebflix-channel"), loads: window.__ytLoads.length };
      });
      assert.equal(before.channel, "suomi");
      assert.equal(before.saved, "suomi");
      assert.equal(before.embed, "vH-KXk8PZc8");
      await page.fill("#search-q", "like a boss");
      await page.waitForSelector("#search-list [data-id='like-a-boss']");
      await page.click("#search-list [data-id='like-a-boss']");
      const held = await page.evaluate(() => ({
        channel: document.body.dataset.channel,
        ch: document.body.dataset.ch,
        tape: window.plebflix.state().spot?.item?.id,
        embed: window.plebflix.state().spot?.item?.embedId,
        mode: window.plebflix.state().mode,
        note: document.querySelector(".search__none")?.textContent || "",
        query: document.querySelector("#search-q").value,
        saved: localStorage.getItem("plebflix-channel"),
        box: document.querySelector(".search__none")?.getBoundingClientRect().toJSON() || null,
        asked: (window.__ytLoads || []).some((row) => row.videoId === "vH-KXk8PZc8"),
      }));
      const eligible = typeof before.added !== "string" || before.added < before.today;
      if (!eligible) {
        assert.ok(held.box && held.box.height > 8 && held.box.width > 40, JSON.stringify(held.box));
        assert.equal(held.channel, "suomi");
        assert.equal(held.ch, "suomi");
        assert.equal(held.tape, before.tape);
        assert.equal(held.mode, "live");
        assert.equal(held.saved, "suomi");
        assert.match(held.query, /like a boss/);
        assert.match(held.note, /joins the programme on \d{4}-\d{2}-\d{2}/);
        assert.match(held.note, /not on today's broadcast/);
        assert.equal(held.asked, false);
      } else {
        assert.equal(held.channel, "international");
        assert.equal(held.ch, "international");
        assert.equal(held.tape, "like-a-boss");
        assert.equal(held.embed, "vH-KXk8PZc8");
        assert.equal(held.saved, "international");
        await page.waitForFunction(() => (window.__ytLoads || []).some((row) => row.id === "yt" && row.videoId === "vH-KXk8PZc8"), { timeout: 2000 });
        const load = await onScreenLoad(page);
        assert.equal(load.videoId, "vH-KXk8PZc8");
        const src = await page.evaluate(() => document.querySelector("iframe#yt")?.src || "");
        assert.match(src, /vH-KXk8PZc8/);
      }
      await page.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-held.png` });
      shots.push({ viewport: viewport.name, held, eligible });

      await page.fill("#search-q", "numa numa");
      await page.waitForSelector("#search-list [data-id='numa-numa']");
      await page.click("#search-list [data-id='numa-numa']");
      await page.waitForFunction(() => {
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return window.plebflix.state().spot?.item?.id === "numa-numa" && load?.videoId === "Cqd1Gvq-RBY";
      }, { timeout: 2000 });
      const numa = await page.evaluate(() => {
        const state = window.plebflix.state();
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return {
          channel: state.channelId,
          id: state.spot.item.id,
          embed: state.spot.item.embedId,
          mode: state.mode,
          shift: state.shift,
          src: document.querySelector("iframe#yt")?.src || "",
          saved: localStorage.getItem("plebflix-channel"),
          body: document.body.dataset.channel,
          load,
        };
      });
      assert.equal(numa.channel, "international");
      assert.equal(numa.body, "international");
      assert.equal(numa.id, "numa-numa");
      assert.equal(numa.embed, "Cqd1Gvq-RBY");
      assert.equal(numa.shift, "skip");
      assert.equal(numa.saved, "international");
      assert.equal(numa.load.videoId, "Cqd1Gvq-RBY");
      assert.match(numa.load.host, /youtube/);
      assert.match(numa.src, /\/embed\/Cqd1Gvq-RBY/);
      await page.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-numa.png` });

      await page.fill("#search-q", "b5mies");
      await page.waitForSelector("#search-list [data-id='b5mies']");
      await page.click("#search-list [data-id='b5mies']");
      await page.waitForFunction(() => {
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return window.plebflix.state().spot?.item?.id === "b5mies" && load?.videoId === "f-lnF5eNFFY";
      }, { timeout: 2000 });
      const suomi = await page.evaluate(() => {
        const state = window.plebflix.state();
        const load = (window.__ytLoads || []).filter((row) => row.id === "yt").at(-1);
        return {
          channel: state.channelId,
          id: state.spot.item.id,
          embed: state.spot.item.embedId,
          src: document.querySelector("iframe#yt")?.src || "",
          saved: localStorage.getItem("plebflix-channel"),
          load,
        };
      });
      assert.equal(suomi.channel, "suomi");
      assert.equal(suomi.id, "b5mies");
      assert.equal(suomi.embed, "f-lnF5eNFFY");
      assert.equal(suomi.saved, "suomi");
      assert.equal(suomi.load.op, "load");
      assert.equal(suomi.load.videoId, "f-lnF5eNFFY");
      assert.match(suomi.load.host, /youtube/);
      assert.match(suomi.src, /\/embed\/f-lnF5eNFFY/);
      shots[shots.length - 1].numa = numa;
      shots[shots.length - 1].suomi = suomi;
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
      const intlBefore = await intl.evaluate(() => window.plebflix.state().spot.item.id);
      await intl.fill("#search-q", "like a boss");
      await intl.waitForSelector("#search-list [data-id='like-a-boss']");
      await intl.click("#search-list [data-id='like-a-boss']");
      const intlHeld = await intl.evaluate(() => ({
        channel: document.body.dataset.channel,
        tape: window.plebflix.state().spot?.item?.id,
        embed: window.plebflix.state().spot?.item?.embedId,
        mode: window.plebflix.state().mode,
        note: document.querySelector(".search__none")?.textContent || "",
        query: document.querySelector("#search-q").value,
        saved: localStorage.getItem("plebflix-channel"),
        box: document.querySelector(".search__none")?.getBoundingClientRect().toJSON() || null,
        asked: (window.__ytLoads || []).some((row) => row.videoId === "vH-KXk8PZc8"),
      }));
      if (!eligible) {
        assert.equal(intlHeld.channel, "international");
        assert.equal(intlHeld.tape, intlBefore);
        assert.equal(intlHeld.mode, "live");
        assert.equal(intlHeld.saved, "international");
        assert.match(intlHeld.query, /like a boss/);
        assert.match(intlHeld.note, /joins the programme on \d{4}-\d{2}-\d{2}/);
        assert.ok(intlHeld.box && intlHeld.box.height > 8, JSON.stringify(intlHeld.box));
        assert.equal(intlHeld.asked, false);
      } else {
        assert.equal(intlHeld.channel, "international");
        assert.equal(intlHeld.tape, "like-a-boss");
        assert.equal(intlHeld.embed, "vH-KXk8PZc8");
        assert.equal(intlHeld.saved, "international");
        const load = await onScreenLoad(intl);
        assert.equal(load.videoId, "vH-KXk8PZc8");
      }
      await intl.screenshot({ path: `/opt/cursor/artifacts/search-${viewport.name}-held-intl.png` });
      shots[shots.length - 1].intlHeld = intlHeld;
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

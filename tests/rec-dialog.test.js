import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("the REC sheet has one scrollport", () => {
  const blocks = [...css.matchAll(/\.rec \{[^}]*\}/g)].map((match) => match[0]);
  assert.ok(blocks.length >= 1);
  for (const block of blocks) assert.doesNotMatch(block, /overflow:\s*auto/);
  assert.match(css, /\.rec \{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.rec__body \{[^}]*overflow-y:\s*auto/);
  assert.match(css, /height:\s*100dvh/);
  assert.doesNotMatch(css, /height:\s*100svh;\s*max-height:\s*100svh/);
});

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

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
          /* try the other root */
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

test("mobile REC scrolls inside the sheet and restores the page on close and Back", { timeout: 60000 }, async (t) => {
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
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    return route.abort();
  });
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#btn-rec", { timeout: 20000 });
    await page.evaluate(() => {
      const pad = document.createElement("div");
      pad.id = "page-pad";
      pad.style.height = "1800px";
      document.body.append(pad);
      window.scrollTo(0, 640);
    });
    const before = await page.evaluate(() => window.scrollY);
    assert.ok(before > 500, `page did not scroll before REC (${before})`);

    await page.click("#btn-rec");
    await page.waitForSelector("#rec-dialog[open]");
    await mkdir("/opt/cursor/artifacts", { recursive: true });
    await page.screenshot({ path: "/opt/cursor/artifacts/rec-mobile-sheet.png" });
    const open = await page.evaluate(() => {
      const dialog = document.getElementById("rec-dialog");
      const body = dialog.querySelector(".rec__body");
      const pad = document.createElement("div");
      pad.id = "rec-pad";
      pad.style.height = "1400px";
      body.append(pad);
      body.scrollTop = 480;
      const dialogStyle = getComputedStyle(dialog);
      const bodyStyle = getComputedStyle(body);
      return {
        locked: document.documentElement.classList.contains("rec-open"),
        bodyOverflow: document.body.style.overflow,
        dialogOverflow: dialogStyle.overflowY,
        sheetOverflow: bodyStyle.overflowY,
        bodyTop: body.scrollTop,
        dialogScroll: dialog.scrollTop,
        pageScroll: window.scrollY,
      };
    });
    assert.equal(open.locked, true);
    assert.equal(open.bodyOverflow, "hidden");
    assert.equal(open.dialogOverflow, "hidden");
    assert.equal(open.sheetOverflow, "auto");
    assert.ok(open.bodyTop >= 400, `sheet body did not scroll (${open.bodyTop})`);
    assert.equal(open.dialogScroll, 0);
    assert.ok(Math.abs(open.pageScroll - before) < 3, `opening REC jumped the page (${open.pageScroll})`);
    const guard = await page.evaluate(() => {
      const outside = new WheelEvent("wheel", { deltaY: 400, cancelable: true, bubbles: true });
      document.querySelector(".foot").dispatchEvent(outside);
      const inside = new WheelEvent("wheel", { deltaY: 40, cancelable: true, bubbles: true });
      document.querySelector(".rec__body").dispatchEvent(inside);
      return { outside: outside.defaultPrevented, inside: inside.defaultPrevented, scrollY: window.scrollY };
    });
    assert.equal(guard.outside, true);
    assert.equal(guard.inside, false);
    assert.ok(Math.abs(guard.scrollY - before) < 3, `the page scrolled behind the sheet (${guard.scrollY})`);
    await page.screenshot({ path: "/opt/cursor/artifacts/rec-mobile-scrolled.png" });

    await page.click("#rec-cancel");
    // open flips off inside close(); the close event (and the scroll restore) follows it.
    await page.waitForFunction(() => !document.documentElement.classList.contains("rec-open"));
    const restored = await page.evaluate(() => ({
      locked: document.documentElement.classList.contains("rec-open"),
      overflow: document.body.style.overflow,
      scrollY: window.scrollY,
      open: document.getElementById("rec-dialog").open,
    }));
    assert.equal(restored.open, false);
    assert.equal(restored.locked, false);
    assert.equal(restored.overflow, "");
    assert.ok(Math.abs(restored.scrollY - before) < 3, `scroll not restored (${restored.scrollY} vs ${before})`);

    await page.evaluate(() => window.scrollTo(0, 640));
    await page.click("#btn-rec");
    await page.waitForSelector("#rec-dialog[open]");
    await page.goBack();
    await page.waitForFunction(() => !document.documentElement.classList.contains("rec-open") && !document.getElementById("rec-dialog").open);
    const afterBack = await page.evaluate(() => ({
      locked: document.documentElement.classList.contains("rec-open"),
      overflow: document.body.style.overflow,
      scrollY: window.scrollY,
    }));
    assert.equal(afterBack.locked, false);
    assert.equal(afterBack.overflow, "");
    assert.ok(Math.abs(afterBack.scrollY - before) < 3, `Back left the page at ${afterBack.scrollY}`);
    await page.screenshot({ path: "/opt/cursor/artifacts/rec-mobile-restored.png" });
    await mkdir("/tmp/rec-mobile", { recursive: true });
    await writeFile("/tmp/rec-mobile/result.json", JSON.stringify({ before, restored, afterBack }));
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

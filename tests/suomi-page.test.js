import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyShareHead, renderShareHead } from "../lib/share-head.mjs";

const cfg = JSON.parse(readFileSync(new URL("../share.config.json", import.meta.url), "utf8"));
const shell = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("index.html keeps one share block for the build to fill", () => {
  assert.equal(shell.split("<!-- share:begin -->").length, 2);
  assert.equal(shell.split("<!-- share:end -->").length, 2);
});
const ALT = "Plebflix TV: a retro media player playing &quot;The Boxing Cats (Prof. Welton's)&quot; (1894), two cats in boxing gloves sparring. Edison Manufacturing Co., public domain.";

test("the main page gets the international card with the config's cache-bust", () => {
  const html = applyShareHead(shell, cfg, "intl");
  const v = `?v=${cfg.version}`;
  assert.ok(html.includes(`<meta property="og:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes(`<meta property="og:image:alt" content="${ALT}">`));
  assert.ok(html.includes(`<meta name="twitter:image:alt" content="${ALT}">`));
  assert.ok(html.includes(`<link id="favicon-svg" rel="icon" type="image/svg+xml" href="/favicons/live/favicon.svg${v}">`));
  assert.ok(html.includes('<meta name="theme-color" content="#0B0D10">'));
  assert.doesNotMatch(html, /og-image-suomi/);
});
test("the /suomi page shares the main card and icons but keeps its own URL, theme colour and lang", () => {
  const html = applyShareHead(shell, cfg, "suomi");
  const v = `?v=${cfg.version}`;
  assert.ok(html.includes(`<meta property="og:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes(`<meta property="og:image:alt" content="${ALT}">`));
  assert.ok(html.includes(`<meta name="twitter:image:alt" content="${ALT}">`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes('<meta property="og:url" content="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<link rel="canonical" href="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<meta name="theme-color" content="#04080D">'));
  assert.ok(html.includes(`<link id="favicon-svg" rel="icon" type="image/svg+xml" href="/favicons/live/favicon.svg${v}">`));
  assert.ok(html.includes(`<link rel="manifest" href="/site.webmanifest${v}">`));
  assert.ok(html.includes('<html lang="fi">'));
  assert.doesNotMatch(html, /og-image-suomi|\/suomi\/favicon|\/suomi\/site\.webmanifest/);
});
test("the share block carries every tag of the v9 head snippet", () => {
  assert.equal(cfg.version, 9);
  const head = renderShareHead(cfg, "intl");
  const snippet = readFileSync(new URL("./fixtures/v5-head-snippet.html", import.meta.url), "utf8");
  for (const tag of snippet.split("\n").map((l) => l.trim()).filter(Boolean)) assert.ok(head.includes(tag), tag);
  assert.doesNotMatch(head, /\?v=[234]\b/);
});
test("bumping the version re-busts every share URL", () => {
  const head = renderShareHead({ ...cfg, version: 4 }, "intl");
  assert.doesNotMatch(head, /\?v=9/);
  assert.equal((head.match(/\?v=4/g) || []).length, 9);
});

test("favicon state: paused wins, then loop, then shuffle, otherwise live", async () => {
  const { faviconState } = await import("../public/favicon-mode.js");
  for (const pm of ["live", "loop", "shuffle"]) {
    assert.equal(faviconState("paused", pm), "paused");
    assert.equal(faviconState("stopped", pm), "paused");
  }
  for (const m of ["live", "timeshift"]) {
    assert.equal(faviconState(m, "loop"), "loop");
    assert.equal(faviconState(m, "shuffle"), "shuffle");
    assert.equal(faviconState(m, "live"), "live");
  }
});
test("every favicon state Iris shipped is in public/", () => {
  for (const st of ["live", "paused", "shuffle", "loop"])
    for (const f of ["favicon.svg", "favicon-32.png", "favicon-16.png", "favicon.ico"])
      assert.ok(readFileSync(new URL(`../public/favicons/${st}/${f}`, import.meta.url)).length > 0, `${st}/${f}`);
});

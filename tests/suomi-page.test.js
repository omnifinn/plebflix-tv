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
test("the main page gets the international card with the config's cache-bust", () => {
  const html = applyShareHead(shell, cfg, "intl");
  const v = `?v=${cfg.version}`;
  assert.ok(html.includes(`<meta property="og:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes(`href="/favicon.svg${v}" type="image/svg+xml" id="favicon-svg"`));
  assert.ok(html.includes('<meta name="theme-color" content="#0B0D10">'));
  assert.doesNotMatch(html, /og-image-suomi/);
});
test("the /suomi page carries the Suomi card, theme colour, icon and manifest", () => {
  const html = applyShareHead(shell, cfg, "suomi");
  const v = `?v=${cfg.version}`;
  assert.ok(html.includes(`<meta property="og:image" content="https://plebflix.com/og-image-suomi.png${v}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="https://plebflix.com/og-image-suomi.png${v}">`));
  assert.ok(html.includes('<meta property="og:url" content="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<link rel="canonical" href="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<meta name="theme-color" content="#04080D">'));
  assert.ok(html.includes(`href="/suomi/favicon.svg${v}" type="image/svg+xml" id="favicon-svg"`));
  assert.ok(html.includes(`<link rel="manifest" href="/suomi/site.webmanifest${v}">`));
  assert.ok(html.includes('<html lang="fi">'));
});
test("bumping the version re-busts every share URL", () => {
  const head = renderShareHead({ ...cfg, version: 3 }, "intl");
  assert.doesNotMatch(head, /\?v=2/);
  assert.equal((head.match(/\?v=3/g) || []).length, 9);
});

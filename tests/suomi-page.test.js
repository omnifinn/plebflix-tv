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
test("the /suomi page shares the main v3 card and icons but keeps its own URL, theme colour and lang", () => {
  const html = applyShareHead(shell, cfg, "suomi");
  const v = `?v=${cfg.version}`;
  assert.ok(html.includes(`<meta property="og:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="https://plebflix.com/og-image.png${v}">`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes('<meta property="og:url" content="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<link rel="canonical" href="https://plebflix.com/suomi">'));
  assert.ok(html.includes('<meta name="theme-color" content="#04080D">'));
  assert.ok(html.includes(`href="/favicon.svg${v}" type="image/svg+xml" id="favicon-svg"`));
  assert.ok(html.includes(`<link rel="manifest" href="/site.webmanifest${v}">`));
  assert.ok(html.includes('<html lang="fi">'));
  assert.doesNotMatch(html, /og-image-suomi|\/suomi\/favicon|\/suomi\/site\.webmanifest/);
});
test("the share block matches Iris's v3 head snippet", () => {
  assert.equal(cfg.version, 3);
  const head = renderShareHead(cfg, "intl");
  for (const tag of [
    '<link rel="icon" href="/favicon.ico?v=3" sizes="16x16 32x32 48x48">',
    '<link rel="icon" href="/favicon.svg?v=3" type="image/svg+xml" id="favicon-svg">',
    '<link rel="icon" href="/favicon-32.png?v=3" type="image/png" sizes="32x32">',
    '<link rel="icon" href="/favicon-16.png?v=3" type="image/png" sizes="16x16">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3">',
    '<link rel="manifest" href="/site.webmanifest?v=3">',
    '<meta property="og:image" content="https://plebflix.com/og-image.png?v=3">',
    '<meta name="twitter:image" content="https://plebflix.com/og-image.png?v=3">',
    '<meta name="twitter:card" content="summary_large_image">',
  ]) assert.ok(head.includes(tag), tag);
  assert.doesNotMatch(head, /\?v=2/);
});
test("bumping the version re-busts every share URL", () => {
  const head = renderShareHead({ ...cfg, version: 4 }, "intl");
  assert.doesNotMatch(head, /\?v=3/);
  assert.equal((head.match(/\?v=4/g) || []).length, 9);
});

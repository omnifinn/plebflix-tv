import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "../scripts/build.mjs";

test("the /tv/ deck is one classic script with syntax an old TV browser parses", async () => {
  await build();
  const html = await readFile("dist/assets/tv/index.html", "utf8");
  assert.doesNotMatch(html, /type="module"/);
  assert.match(html, /<script defer src="\/tv\/bundle\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/tv\/tv\.css\?v=[0-9a-f]{10}">/);
  assert.doesNotMatch(html, /href="\/styles\.css/);
  const js = await readFile("dist/assets/tv/bundle.js", "utf8");
  assert.doesNotMatch(js, /\?\.[A-Za-z_$[(]/, "optional chaining reached the TV bundle");
  assert.doesNotMatch(js, /[^?]\?\?[^?]/, "nullish coalescing reached the TV bundle");
  assert.match(js, /10009/, "the remote driver (BACK = 10009) is in the bundle");
  const css = await readFile("dist/assets/tv/tv.css", "utf8");
  assert.doesNotMatch(css, /inset:/);
  assert.match(css, /is-tv/);
});

test("the packaged TV app keeps its upgrade identity and local shell", async () => {
  const config = await readFile("tizen/config.xml", "utf8");
  assert.match(config, /<tizen:application id="PlbFlx2026\.PlebflixTV" package="PlbFlx2026"/);
  assert.match(config, /privilege\/tv\.inputdevice/);
  const html = await readFile("tizen/index.html", "utf8");
  assert.match(html, /src="bundle.js"/);
  assert.doesNotMatch(html, /https:\/\/plebflix\.com\/tv/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "../scripts/build.mjs";

test("the old TV deck is no longer built; the player shim remains", async () => {
  await build();
  const { access } = await import("node:fs/promises");
  await assert.rejects(access("dist/assets/tv/index.html"));
  await access("dist/assets/tv/yt.html");
  await access("dist/assets/tv/yt-shim.js");
});

test("the packaged TV app keeps its upgrade identity and local shell", async () => {
  const config = await readFile("tizen/config.xml", "utf8");
  assert.match(config, /<tizen:application id="PlbFlx2026\.PlebflixTV" package="PlbFlx2026"/);
  assert.match(config, /privilege\/tv\.inputdevice/);
  const html = await readFile("tizen/index.html", "utf8");
  assert.match(html, /src="bundle.js"/);
  assert.doesNotMatch(html, /https:\/\/plebflix\.com\/tv/);
});

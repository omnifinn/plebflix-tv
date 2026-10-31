import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";
import { renderCredits } from "../lib/credits-page.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "plebflix-worker-"));
const outfile = path.join(dir, "worker.js");
await esbuild.build({
  entryPoints: ["src/worker.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
});
const { default: worker } = await import(pathToFileURL(outfile).href);
test.after(() => rm(dir, { recursive: true, force: true }));

/** Assets answer the extensionless path with the page, and 307 a .html request back to it. */
function assets() {
  const hits = [];
  return {
    hits,
    async fetch(request) {
      const url = new URL(request.url);
      hits.push(url.pathname);
      if (url.pathname.endsWith(".html")) {
        return new Response(null, {
          status: 307,
          headers: { location: url.pathname.replace(/\.html$/, "") },
        });
      }
      if (url.pathname === "/credits" || url.pathname === "/takedown") {
        const label = url.pathname === "/credits" ? "Credits" : "takedown@plebflix.com";
        return new Response(`<!doctype html><title>${label}</title>`, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("missing", { status: 404 });
    },
  };
}

test("credits and takedown are 200 and do not loop on the .html redirect", async () => {
  for (const pathname of ["/credits", "/credits/", "/takedown", "/takedown/"]) {
    let url = `https://plebflix.test${pathname}`;
    const seen = [];
    let response;
    let assetPaths = [];
    for (let hop = 0; hop < 4; hop += 1) {
      seen.push(new URL(url).pathname);
      const binding = assets();
      response = await worker.fetch(new Request(url), { ASSETS: binding });
      assetPaths = binding.hits;
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      assert.ok(location, `${pathname} redirect has no Location`);
      url = new URL(location, url).href;
    }
    assert.equal(response.status, 200, `${pathname} ended at ${response.status} via ${seen.join(" -> ")}`);
    assert.equal(seen.length, 1, `${pathname} redirected (${seen.join(" -> ")})`);
    assert.equal(
      assetPaths.some((hit) => hit.endsWith(".html")),
      false,
      `${pathname} asked assets for ${assetPaths.join(", ")}`,
    );
    const html = await response.text();
    assert.match(html, pathname.startsWith("/credits") ? /Credits/ : /takedown@plebflix.com/);
  }
});

test("credits names the share image and links the Wikimedia Commons file", () => {
  const html = renderCredits([]);
  assert.match(
    html,
    /The Boxing Cats \(Prof\. Welton's\) \(1894\), Edison Manufacturing Co\. \/ W\. K\. L\. Dickson &amp; William Heise\. Public domain, via Wikimedia Commons\./,
  );
  assert.match(html, /https:\/\/commons\.wikimedia\.org\/wiki\/File:The_boxing_cats_\(Prof\._Welton%27s\)\.ogv/);
});

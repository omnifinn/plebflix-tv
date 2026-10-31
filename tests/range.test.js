import test from "node:test";
import assert from "node:assert/strict";
import { parseRange, serveMedia } from "../legacy/range.mjs";
test("parseRange", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.equal(parseRange("bytes=2000-", 1000), "unsatisfiable");
  assert.equal(parseRange("junk", 1000), null);
});
test("serveMedia slices across chunks", async () => {
  const data = new Uint8Array(1000).map((_, i) => i % 256);
  const assets = { fetch: async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 1000; i += 64) c.enqueue(data.slice(i, i + 64)); c.close(); } }), { headers: { "content-length": "1000", "content-type": "video/mp4" } }) };
  const res = await serveMedia(new Request("https://x/media/a.mp4", { headers: { range: "bytes=100-299" } }), assets);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 100-299/1000");
  const got = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(got, data.slice(100, 300));
});
test("serveMedia without content-length buffers", async () => {
  const data = new Uint8Array(500).map((_, i) => i % 256);
  const assets = { fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(data); c.close(); } })) };
  const res = await serveMedia(new Request("https://x/m.mp4", { headers: { range: "bytes=10-" } }), assets);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 10-499/500");
  assert.equal((await res.arrayBuffer()).byteLength, 490);
});
test("serveMedia prefers the edge cache", async () => {
  const store = new Map();
  const cache = { match: async (r) => store.has(r.url) ? new Response("hit", { status: r.headers.get("range") ? 206 : 200 }) : undefined, put: async (k, v) => { store.set(k.url, await v.arrayBuffer()); } };
  let fetched = 0;
  const assets = { fetch: async (r) => { if (r.method === "GET") fetched++; return new Response(r.method === "HEAD" ? null : "abc", { headers: { "content-length": "3", etag: '"e1"' } }); } };
  const req = () => new Request("https://x/media/a.mp4", { headers: { range: "bytes=0-1" } });
  assert.equal((await serveMedia(req(), assets, cache)).status, 206);
  assert.equal((await serveMedia(req(), assets, cache)).status, 206);
  assert.equal(fetched, 1);
  assert.ok([...store.keys()][0].endsWith("?v=e1"));
});
test("a re-encoded tape (new ETag) never comes back stale from the cache", async () => {
  const store = new Map();
  const cache = { match: async (r) => (store.has(r.url) ? new Response(store.get(r.url), { status: 200 }) : undefined), put: async (k, v) => { store.set(k.url, await v.arrayBuffer()); } };
  let tag = "old";
  const assets = { fetch: async (r) => new Response(r.method === "HEAD" ? null : tag, { headers: { etag: `"${tag}"` } }) };
  const get = async () => new TextDecoder().decode(await (await serveMedia(new Request("https://x/media/a.mp4"), assets, cache)).arrayBuffer());
  assert.equal(await get(), "old");
  tag = "new";
  assert.equal(await get(), "new");
});
test("cache hits carry accept-ranges", async () => {
  const cache = { match: async () => new Response("ab", { status: 206, headers: { "content-type": "video/mp4", "content-length": "2" } }), put: async () => {} };
  const res = await serveMedia(new Request("https://x/media/a.mp4", { headers: { range: "bytes=0-1" } }), { fetch: async () => new Response("") }, cache);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.status, 206);
  const head = await serveMedia(new Request("https://x/media/a.mp4", { method: "HEAD" }), { fetch: async () => new Response("") }, cache);
  assert.equal(head.headers.get("content-length"), "2");
});
test("cold cache answers at once and fills the cache behind", async () => {
  const data = new Uint8Array(1000).map((_, i) => i % 256);
  const puts = [];
  const cache = { match: async () => undefined, put: async (k, v) => { puts.push(k.url); await v.arrayBuffer(); } };
  const assets = { fetch: async () => new Response(data, { headers: { "content-length": "1000", "content-type": "video/mp4" } }) };
  const waits = [];
  const res = await serveMedia(new Request("https://x/media/a.mp4", { headers: { range: "bytes=0-1" } }), assets, cache, (p) => waits.push(p));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-length"), "2");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
  await Promise.all(waits);
  assert.deepEqual(puts, ["https://x/media/a.mp4"]);
});

test("suffix zero and inverted ranges are unsatisfiable, garbage is ignored", async () => {
  assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=5-2", 1000), null); // invalid spec: ignored, full 200
  assert.equal(parseRange("bytes=99999999999999999999-", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=abc", 1000), null);
  assert.equal(parseRange("bytes=0-0,5-9", 1000), null);
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=990-5000", 1000), { start: 990, end: 999 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { handleImpression, handleStats, handleVote, memoryStore, resetVoteLimitersForTests } from "../lib/votes.mjs";
import { handleSubmit, resetSubmissionLimiterForTests } from "../lib/submissions.mjs";

const viewer = "33333333-3333-4333-8333-333333333333";
const post = (path, body) => new Request(`https://plebflix.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("plays arrive in one batch and unknown tapes are skipped", async () => {
  resetVoteLimitersForTests();
  const store = memoryStore();
  const res = await handleImpression(post("/api/impression", { viewerId: viewer, plays: [{ itemId: "b5mies", channel: "suomi" }, { itemId: "numa-numa", channel: "international" }, { itemId: "nope-not-here", channel: "suomi" }] }), { VOTE_STORE: store });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).counted, 2);
});

test("stats are served from the edge cache after the first read", async () => {
  const map = new Map();
  const cache = { async match(r) { const v = map.get(r.url); return v ? new Response(v) : undefined; }, async put(r, res) { map.set(r.url, await res.text()); } };
  let reads = 0;
  const store = { ...memoryStore(), async stats() { reads += 1; return {}; } };
  const env = { VOTE_STORE: store, STATS_CACHE: cache };
  const url = "https://plebflix.test/api/stats?channel=suomi&day=2026-10-01";
  const a = await handleStats(new Request(url), env);
  const b = await handleStats(new Request(url), env);
  assert.equal(a.headers.get("x-stats-cache"), "miss");
  assert.equal(b.headers.get("x-stats-cache"), "hit");
  assert.equal(reads, 1);
  assert.match(b.headers.get("cache-control"), /max-age=3600/);
});

test("the edge rate limiter turns votes and REC away with 429", async () => {
  resetVoteLimitersForTests();
  resetSubmissionLimiterForTests();
  const deny = { async limit() { return { success: false } } };
  const v = await handleVote(post("/api/vote", { itemId: "b5mies", channel: "suomi", vote: "up", viewerId: viewer }), { VOTE_STORE: memoryStore(), VOTE_RL: deny });
  assert.equal(v.status, 429);
  const p = await handleImpression(post("/api/impression", { itemId: "b5mies", channel: "suomi", viewerId: viewer }), { VOTE_STORE: memoryStore(), PLAY_RL: deny });
  assert.equal(p.status, 429);
  const db = { prepare() { return { bind() { return this; }, async first() { return { n: 0 }; }, async run() { return {}; } }; } };
  const r = await handleSubmit(post("/api/recommend", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", channel: "international", year: 2007 }), { DB: db, REC_RL: deny });
  assert.equal(r.status, 429);
});

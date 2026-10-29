import assert from "node:assert/strict";
import test from "node:test";
import {
  d1Store,
  handleImpression,
  handleStats,
  handleVote,
  memoryStore,
  resetVoteLimitersForTests,
} from "../lib/votes.mjs";

function post(path, body, extra = {}) {
  return new Request(`https://plebflix.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
}

const viewer = "11111111-1111-4111-8111-111111111111";

test("a viewer can vote once, and yesterday's plays show up in today's stats", async () => {
  resetVoteLimitersForTests();
  const store = memoryStore();
  const env = { VOTE_STORE: store };
  const first = await handleVote(
    post("/api/vote", { itemId: "b5mies", channel: "suomi", vote: "up", viewerId: viewer }),
    env,
  );
  assert.equal(first.status, 200);
  const again = await handleVote(
    post("/api/vote", { itemId: "b5mies", channel: "suomi", vote: "down", viewerId: viewer }),
    env,
  );
  assert.equal(again.status, 409);
  const other = await handleVote(
    post("/api/vote", {
      itemId: "b5mies",
      channel: "suomi",
      vote: "down",
      viewerId: "22222222-2222-4222-8222-222222222222",
    }),
    env,
  );
  assert.equal(other.status, 200);
  const play = await handleImpression(
    post("/api/impression", { itemId: "b5mies", channel: "suomi", viewerId: viewer }),
    env,
  );
  assert.equal(play.status, 200);

  store.async = null;
  const rows = store;
  const yesterday = "2020-01-01T12:00:00.000Z";
  const shelf = memoryStore();
  await shelf.addVote({
    viewerId: viewer,
    itemId: "b5mies",
    channel: "suomi",
    vote: 1,
    createdAt: yesterday,
  });
  await shelf.addImpression({
    viewerId: viewer,
    itemId: "b5mies",
    channel: "suomi",
    day: "2020-01-01",
    createdAt: yesterday,
  });
  await shelf.addVote({
    viewerId: "33333333-3333-4333-8333-333333333333",
    itemId: "b5mies",
    channel: "suomi",
    vote: 1,
    createdAt: "2026-10-29T01:00:00.000Z",
  });
  const stats = await handleStats(new Request("https://plebflix.test/api/stats?channel=suomi&day=2026-10-29"), {
    VOTE_STORE: shelf,
  });
  const body = await stats.json();
  assert.equal(body.items.b5mies.up, 1);
  assert.equal(body.items.b5mies.down, 0);
  assert.equal(body.items.b5mies.net, 1);
  assert.equal(body.items.b5mies.impressions, 1);
  assert.ok(body.items.b5mies.wilson > 0);
  assert.equal(rows && play.ok, play.ok);
});

test("a missing shelf says so, and a junk tape is refused", async () => {
  resetVoteLimitersForTests();
  const missing = await handleVote(
    post("/api/vote", { itemId: "b5mies", channel: "suomi", vote: "up", viewerId: viewer }),
    {},
  );
  assert.equal(missing.status, 503);
  const text = await missing.json();
  assert.match(text.error, /plebflix-tv/);
  const unknown = await handleStats(new Request("https://plebflix.test/api/stats?channel=nope"), {
    VOTE_STORE: memoryStore(),
  });
  assert.equal(unknown.status, 400);
  const absent = await handleVote(
    post("/api/vote", { itemId: "not-a-real-tape", channel: "suomi", vote: "up", viewerId: viewer }),
    { VOTE_STORE: memoryStore() },
  );
  assert.equal(absent.status, 404);
});

test("the D1 store writes the vote table", async () => {
  /** @type {string[]} */
  const sql = [];
  const db = {
    prepare(statement) {
      let bound = [];
      return {
        bind(...args) {
          bound = args;
          return this;
        },
        async first() {
          return null;
        },
        async run() {
          sql.push(statement);
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          sql.push(`${statement} ${bound.join(",")}`);
          return { results: [{ itemId: "numa-numa", up: 2, down: 1 }] };
        },
      };
    },
  };
  const store = d1Store(db);
  assert.equal(
    await store.addVote({
      viewerId: viewer,
      itemId: "numa-numa",
      channel: "international",
      vote: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  );
  assert.match(sql[0], /INSERT INTO votes/);
  const stats = await store.stats("international", "2026-10-29T00:00:00.000Z");
  assert.equal(stats["numa-numa"].up, 2);
  assert.equal(stats["numa-numa"].down, 1);
});

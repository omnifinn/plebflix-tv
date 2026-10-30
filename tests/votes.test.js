import assert from "node:assert/strict";
import test from "node:test";
import {
  IP_ITEM_CAP,
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

test("one address casts at most a handful of votes on a tape, whatever viewer ids it invents", async () => {
  resetVoteLimitersForTests();
  const env = { VOTE_STORE: memoryStore() };
  const vote = (viewerId, ip) =>
    handleVote(post("/api/vote", { itemId: "b5mies", channel: "suomi", vote: "down", viewerId }, { "CF-Connecting-IP": ip }), env);
  for (let i = 0; i < IP_ITEM_CAP; i += 1) {
    assert.equal((await vote(`33333333-3333-4333-8333-33333333333${i}`, "203.0.113.9")).status, 200);
  }
  const capped = await vote("44444444-4444-4444-8444-444444444444", "203.0.113.9");
  assert.equal(capped.status, 409);
  // A different /64 is a different household and still votes.
  assert.equal((await vote("55555555-5555-4555-8555-555555555555", "2001:db8:9:9::1")).status, 200);
  // The same /64 with a rotated suffix is the same household.
  for (let i = 1; i < IP_ITEM_CAP; i += 1) {
    assert.equal((await vote(`66666666-6666-4666-8666-66666666666${i}`, `2001:db8:9:9:${i}::1`)).status, 200);
  }
  assert.equal((await vote("77777777-7777-4777-8777-777777777777", "2001:db8:9:9:ffff::1")).status, 409);
  // Another tape on the same address is a fresh count.
  assert.equal((await handleVote(post("/api/vote", { itemId: "kahen-kilon-siika", channel: "suomi", vote: "up", viewerId: "88888888-8888-4888-8888-888888888888" }, { "CF-Connecting-IP": "203.0.113.9" }), env)).status, 200);
});

test("the D1 store writes the address hash and refuses the cap", async () => {
  const rows = [];
  const db = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.startsWith("SELECT vote")) return rows.find((r) => r.viewer_id === args[0] && r.item_id === args[1]) || null;
          if (sql.startsWith("SELECT COUNT")) return { n: rows.filter((r) => r.item_id === args[0] && r.ip_hash === args[1]).length };
          return null;
        },
        async run() {
          rows.push({ viewer_id: args[0], item_id: args[1], channel: args[2], vote: args[3], created_at: args[4], ip_hash: args[5] });
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  const store = d1Store(db);
  for (let i = 0; i < IP_ITEM_CAP; i += 1) {
    assert.equal(await store.addVote({ viewerId: `v${i}`, itemId: "b5mies", channel: "suomi", vote: 1, createdAt: "2026-01-01T00:00:00.000Z", ipHash: "abc" }), true);
  }
  assert.equal(await store.addVote({ viewerId: "v-late", itemId: "b5mies", channel: "suomi", vote: 1, createdAt: "2026-01-01T00:00:00.000Z", ipHash: "abc" }), false);
  assert.equal(rows.length, IP_ITEM_CAP);
  assert.equal(rows[0].ip_hash, "abc");
  // A row without an address (old clients, tests) still files, with NULL.
  assert.equal(await store.addVote({ viewerId: "v-null", itemId: "b5mies", channel: "suomi", vote: 1, createdAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(rows.at(-1).ip_hash, null);
});

function get(path, extra = {}) {
  return new Request(`https://plebflix.test${path}`, { headers: extra });
}

test("stats refuse prototype names and days outside the week-plus-tomorrow window", async () => {
  const env = { VOTE_STORE: memoryStore(), STATS_CACHE: null };
  assert.equal((await handleStats(get("/api/stats?channel=constructor"), env)).status, 400);
  assert.equal((await handleStats(get("/api/stats?channel=__proto__"), env)).status, 400);
  assert.equal((await handleStats(get("/api/stats?channel=suomi&day=1999-01-01"), env)).status, 400);
  assert.equal((await handleStats(get("/api/stats?channel=suomi&day=2026-02-30"), env)).status, 400);
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const tomorrow = iso(new Date(today.getTime() + 86400000));
  const twoDays = iso(new Date(today.getTime() + 2 * 86400000));
  const weekAgo = iso(new Date(today.getTime() - 7 * 86400000));
  const eightDays = iso(new Date(today.getTime() - 8 * 86400000));
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${tomorrow}`), env)).status, 200);
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${weekAgo}`), env)).status, 200);
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${twoDays}`), env)).status, 400);
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${eightDays}`), env)).status, 400);
});

test("a frozen day and a day still ahead are cached under different keys, and a miss is rate limited", async () => {
  const puts = [];
  const cache = { async match() { return undefined; }, async put(key) { puts.push(key.url); } };
  const env = { VOTE_STORE: memoryStore(), STATS_CACHE: cache };
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${today}`), env)).status, 200);
  assert.equal((await handleStats(get(`/api/stats?channel=suomi&day=${tomorrow}`), env)).status, 200);
  assert.match(puts[0], new RegExp(`/suomi/${today}/frozen$`));
  assert.match(puts[1], new RegExp(`/suomi/${tomorrow}/live$`));
  let calls = 0;
  const limited = { ...env, PLAY_RL: { async limit() { calls += 1; return { success: false }; } } };
  const r = await handleStats(get(`/api/stats?channel=suomi&day=${today}`), limited);
  assert.equal(r.status, 429);
  assert.equal(calls, 1);
});

test("the edge play limit is spent per row, so a packed batch cannot outrun it", async () => {
  resetVoteLimitersForTests();
  let budget = 10;
  const env = { VOTE_STORE: memoryStore(), PLAY_RL: { async limit() { budget -= 1; return { success: budget >= 0 }; } } };
  const plays = ["b5mies", "kahen-kilon-siika", "ismo-seppo-pyorailee"].map((itemId) => ({ itemId, channel: "suomi" }));
  const small = await handleImpression(post("/api/impression", { viewerId: viewer, plays }), env);
  assert.equal(small.status, 200);
  assert.equal(budget, 7);
  const big = await handleImpression(post("/api/impression", { viewerId: "99999999-9999-4999-8999-999999999999", plays: Array.from({ length: 12 }, () => plays[0]) }), env);
  assert.equal(big.status, 429);
});

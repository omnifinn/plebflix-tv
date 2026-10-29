import assert from "node:assert/strict";
import test from "node:test";
import { extractEmbed, handleRecommend, resetLimiterForTests } from "../lib/recommend.mjs";

const repo = {
  id: "suomi",
  number: 1,
  name: "Suomi",
  tagline: "Test",
  items: [
    {
      id: "sandstorm",
      title: "Sandstorm",
      year: 1999,
      source: "youtube",
      embedId: "y6120QOlsfU",
      duration: 233,
      note: "A loop.",
      credit: "https://www.youtube.com/watch?v=y6120QOlsfU",
      signals: ["b", "c", "e"],
      why: "The track still defines a loading-screen scene.",
      original_url: "https://www.youtube.com/watch?v=y6120QOlsfU",
    },
  ],
};
const intl = {
  id: "international",
  number: 2,
  name: "International",
  tagline: "Test",
  items: [
    {
      id: "badgers",
      title: "Badgers",
      year: 2003,
      source: "youtube",
      embedId: "EIyixC9NsLI",
      duration: 74,
      note: "Mushroom.",
      credit: "https://www.youtube.com/watch?v=EIyixC9NsLI",
      signals: ["a", "b", "c", "d"],
      why: "Weebl's animated badger loop.",
      original_url: "https://www.youtube.com/watch?v=EIyixC9NsLI",
    },
  ],
};

function encode(doc) {
  return Buffer.from(JSON.stringify(doc), "utf8").toString("base64");
}

test("extracts youtube, vimeo, and archive.org ids", () => {
  assert.deepEqual(extractEmbed("https://youtu.be/dQw4w9WgXcQ"), {
    source: "youtube",
    embedId: "dQw4w9WgXcQ",
  });
  assert.deepEqual(extractEmbed("https://www.youtube.com/shorts/jNQXAC9IVRw"), {
    source: "youtube",
    embedId: "jNQXAC9IVRw",
  });
  assert.deepEqual(extractEmbed("https://vimeo.com/12345678"), {
    source: "vimeo",
    embedId: "12345678",
  });
  assert.deepEqual(extractEmbed("https://archive.org/details/thd"), {
    source: "archive.org",
    embedId: "thd",
  });
  assert.equal(extractEmbed("http://youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractEmbed("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.deepEqual(
    extractEmbed("https://web.archive.org/web/20041211162602/http://www.newgrounds.com:80/portal/view/206373"),
    {
      source: "other",
      embedId: "https://web.archive.org/web/20041211162602/http://www.newgrounds.com:80/portal/view/206373",
    },
  );
  assert.equal(extractEmbed("https://en.wikipedia.org/wiki/Numa_Numa")?.source, "other");
});

test("missing token fails clearly and does not call GitHub", async () => {
  resetLimiterForTests();
  let called = false;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not fetch");
  };
  try {
    const response = await handleRecommend(post(card({ url: "https://youtu.be/dQw4w9WgXcQ", channel: "suomi" })), {
      GITHUB_REPO: "omnifinn/plebflix-tv",
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /GITHUB_TOKEN/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("honeypot returns quietly", async () => {
  resetLimiterForTests();
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("should not fetch");
  };
  try {
    const response = await handleRecommend(
      post({ url: "https://youtu.be/dQw4w9WgXcQ", channel: "suomi", company: "spam" }),
      { GITHUB_TOKEN: "test", GITHUB_REPO: "omnifinn/plebflix-tv" },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.prUrl, undefined);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a real filing opens a pull request and rejects duplicates", async () => {
  resetLimiterForTests();
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.github.com", "");
    calls.push({ path, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (path === "/repos/omnifinn/plebflix-tv") return ok({ default_branch: "main" });
    if (path.startsWith("/repos/omnifinn/plebflix-tv/git/ref/heads/")) return ok({ object: { sha: "base" } });
    if (path === "/repos/omnifinn/plebflix-tv/git/commits/base") return ok({ tree: { sha: "tree" } });
    if (path.startsWith("/repos/omnifinn/plebflix-tv/contents/channels/suomi.json")) {
      return ok({ content: encode(repo) });
    }
    if (path.startsWith("/repos/omnifinn/plebflix-tv/contents/channels/international.json")) {
      return ok({ content: encode(intl) });
    }
    if (path === "/repos/omnifinn/plebflix-tv/git/blobs") return ok({ sha: `blob-${calls.length}` });
    if (path === "/repos/omnifinn/plebflix-tv/git/trees") return ok({ sha: "newtree" });
    if (path === "/repos/omnifinn/plebflix-tv/git/commits") return ok({ sha: "newcommit" });
    if (path === "/repos/omnifinn/plebflix-tv/git/refs" && init.method === "POST") return ok({ ref: "ok" });
    if (path === "/repos/omnifinn/plebflix-tv/pulls") {
      return ok({ html_url: "https://github.com/omnifinn/plebflix-tv/pull/7" });
    }
    return new Response(JSON.stringify({ message: `unexpected ${path}` }), { status: 500 });
  };
  try {
    const response = await handleRecommend(
      post(
        card({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          channel: "suomi",
          title: "Never Gonna Give You Up",
          note: "The polite version of a rickroll.",
        }),
      ),
      { GITHUB_TOKEN: "test-token", GITHUB_REPO: "omnifinn/plebflix-tv" },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.prUrl, "https://github.com/omnifinn/plebflix-tv/pull/7");
    const blob = calls.find((call) => call.path === "/repos/omnifinn/plebflix-tv/git/blobs");
    assert.match(blob.body.content, /"status": "pending"/);
    assert.match(blob.body.content, /dQw4w9WgXcQ/);
    const pr = calls.find((call) => call.path === "/repos/omnifinn/plebflix-tv/pulls");
    assert.match(pr.body.head, /^rec\/suomi\//);
    assert.match(pr.body.body, /\(a\) Born online/);
    assert.match(pr.body.body, /\(e\) Defined its scene/);
    assert.match(blob.body.content, /"original_url"/);

    calls.length = 0;
    const again = await handleRecommend(
      post(card({ url: "https://youtu.be/y6120QOlsfU", channel: "suomi", title: "Sandstorm" })),
      { GITHUB_TOKEN: "test-token", GITHUB_REPO: "omnifinn/plebflix-tv" },
    );
    const dup = await again.json();
    assert.equal(again.status, 409);
    assert.match(dup.error, /already on the shelf/);
    assert.equal(calls.some((call) => call.path.endsWith("/pulls")), false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("rate limit trips after five filings from one address", async () => {
  resetLimiterForTests();
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 500 });
  try {
    const env = {};
    for (let i = 0; i < 5; i += 1) {
      const response = await handleRecommend(post({ url: "not a url", channel: "suomi" }), env);
      assert.equal(response.status, 400);
    }
    const blocked = await handleRecommend(post({ url: "not a url", channel: "suomi" }), env);
    assert.equal(blocked.status, 429);
  } finally {
    globalThis.fetch = previous;
  }
});

function card(body) {
  return {
    year: 2004,
    why: "A webcam clip people still quote.",
    signals: ["a", "b", "c", "d"],
    ...body,
  };
}

function post(body, ip = "203.0.113.9") {
  return new Request("https://plebflix.com/api/recommend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://plebflix.com",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

function ok(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

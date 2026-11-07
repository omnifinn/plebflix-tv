import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, resetSubmissionLimiterForTests } from "../lib/submissions.mjs";
import { recStatusMessage, reviewDocument } from "../lib/rec-pr.mjs";

const YOUTUBE = "https://youtu.be/vH-KXk8PZc8?is=dFb7TNWmNSaoRa4e";
const WATCH = "https://www.youtube.com/watch?v=vH-KXk8PZc8";
const PR = "https://github.com/omnifinn/plebflix-tv/pull/21";

function db() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) {
          args = a;
          return stmt;
        },
        async first() {
          if (sql.startsWith("SELECT COUNT")) return { n: rows.filter((r) => r.ip_hash === args[0] && r.created_at > args[1]).length };
          return null;
        },
        async all() {
          const video = args[1];
          return { results: rows.filter((r) => r.url === args[0] || (video && r.url.includes(video))) };
        },
        async run() {
          if (sql.startsWith("UPDATE")) {
            const row = rows.find((r) => r.id === args[1] && !r.pr_url);
            if (row) row.pr_url = args[0];
            return { success: true };
          }
          const [id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at] = args;
          rows.push({ id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at, status: "pending", pr_url: null });
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

const post = (body, ip = "8.8.4.4") =>
  new Request("https://plebflix.com/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });

function githubMock(opts = {}) {
  const calls = [];
  const trees = [];
  const blobs = [];
  let pullsPosted = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    calls.push(`${method} ${u.pathname}`);
    assert.equal(u.host, "api.github.com");
    assert.equal(u.username, "");
    assert.equal(u.password, "");
    assert.equal(String(url).includes("test-token"), false);
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.doesNotMatch(u.pathname, /youtu\.be|evil\.example|watch/);
    assert.doesNotMatch(u.search, /youtu\.be|evil\.example/);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.pathname === "/search/issues") {
      const q = u.searchParams.get("q") || "";
      if (opts.searchHit && q.includes(opts.searchHit.marker)) return json({ items: [{ html_url: opts.searchHit.url }] });
      return json({ items: [] });
    }
    if (u.pathname === "/repos/omnifinn/plebflix-tv" && method === "GET") return json({ default_branch: "main" });
    if (u.pathname.startsWith("/repos/omnifinn/plebflix-tv/git/ref/heads/")) {
      if (u.pathname.endsWith("/heads/main")) return json({ object: { sha: "basesha" } });
      if (opts.branchExists) return json({ object: { sha: "branchsha" } });
      return json({ message: "Not Found" }, 404);
    }
    if (u.pathname.endsWith("/git/blobs")) {
      blobs.push(JSON.parse(init.body));
      return json({ sha: "blobsha" });
    }
    if (u.pathname.endsWith("/git/commits/basesha")) return json({ tree: { sha: "basesha-tree" } });
    if (u.pathname.endsWith("/git/trees")) {
      trees.push(JSON.parse(init.body));
      return json({ sha: "treesha" });
    }
    if (u.pathname.endsWith("/git/commits") && method === "POST") return json({ sha: "commitsha" });
    if (u.pathname.endsWith("/git/refs") && method === "POST") return json({ ref: "refs/heads/rec" });
    if (u.pathname === "/repos/omnifinn/plebflix-tv/pulls" && method === "GET") return json(opts.openPulls || []);
    if (u.pathname === "/repos/omnifinn/plebflix-tv/pulls" && method === "POST") {
      pullsPosted += 1;
      if (pullsPosted <= (opts.failPulls || 0)) return json({ message: "unavailable" }, 502);
      return json({ html_url: PR });
    }
    return json({ message: `unexpected ${method} ${u.pathname}` }, 500);
  };
  return { fetchImpl, calls, trees, blobs, pulls: () => pullsPosted };
}

function env(shelf, gh, extra = {}) {
  return { DB: shelf, GITHUB_TOKEN: "test-token", GITHUB_REPO: "omnifinn/plebflix-tv", fetchImpl: gh.fetchImpl, ...extra };
}

test("a saved link opens one review pull request and does not edit the shelf", async () => {
  resetSubmissionLimiterForTests();
  const gh = githubMock();
  const shelf = db();
  const response = await handleSubmit(post({ url: YOUTUBE, channel: "international" }), env(shelf, gh));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.saved, true);
  assert.equal(body.prOpened, true);
  assert.equal(body.prUrl, PR);
  assert.match(body.message, /review pull request is open/);
  assert.match(body.message, /not on air/);
  assert.doesNotMatch(body.message, /approved for the shelf|on air now/);
  assert.equal(shelf.rows.length, 1);
  assert.equal(shelf.rows[0].status, "pending");
  assert.equal(shelf.rows[0].pr_url, PR);
  assert.equal(gh.pulls(), 1);
  assert.equal(gh.trees.length, 1);
  assert.deepEqual(gh.trees[0].tree.map((file) => file.path), [`rec-inbox/${shelf.rows[0].id}.json`]);
  const filed = JSON.parse(gh.blobs[0].content);
  assert.equal(filed.approved, false);
  assert.equal(filed.on_air, false);
  assert.equal(filed.embed_id, "vH-KXk8PZc8");
  assert.equal(filed.title, undefined);
  assert.equal(filed.year, undefined);
  assert.equal(filed.duration, undefined);
  assert.ok(gh.calls.every((call) => call.startsWith("GET ") || call.startsWith("POST ")));
  assert.equal(gh.calls.some((call) => call.includes("channels/")), false);

  const calls = gh.calls.length;
  const again = await handleSubmit(post({ url: WATCH, channel: "international" }), env(shelf, gh));
  const duplicate = await again.json();
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.prUrl, PR);
  assert.equal(shelf.rows.length, 1);
  assert.equal(gh.pulls(), 1);
  assert.equal(gh.calls.length, calls);
});

test("GitHub failing once still keeps the row, and the same link retries without a second row", async () => {
  resetSubmissionLimiterForTests();
  const shelf = db();
  const down = githubMock({ failPulls: 2 });
  const first = await handleSubmit(post({ url: "https://evil.example/clip" }, "8.8.8.8"), env(shelf, down));
  const saved = await first.json();
  assert.equal(saved.saved, true);
  assert.equal(saved.prOpened, false);
  assert.match(saved.message, /did not open a pull request/);
  assert.doesNotMatch(saved.message, /pull request is open/);
  assert.equal(shelf.rows.length, 1);
  assert.equal(shelf.rows[0].pr_url, null);
  assert.equal(down.calls.some((call) => call.includes("evil.example")), false);

  const up = githubMock();
  const second = await handleSubmit(post({ url: "https://evil.example/clip" }, "8.8.8.8"), env(shelf, up));
  const retried = await second.json();
  assert.equal(retried.duplicate, true);
  assert.equal(retried.prOpened, true);
  assert.equal(retried.prUrl, PR);
  assert.equal(shelf.rows.length, 1);
  assert.equal(shelf.rows[0].pr_url, PR);
  assert.equal(up.trees.length, 1);
});

test("an existing review pull request is reused and a foreign repo is refused", async () => {
  resetSubmissionLimiterForTests();
  const shelf = db();
  const existing = "https://github.com/omnifinn/plebflix-tv/pull/10";
  const gh = githubMock({ searchHit: { marker: "plebflix-video:vH-KXk8PZc8", url: existing } });
  const response = await handleSubmit(post({ url: WATCH }, "1.1.1.1"), env(shelf, gh));
  const body = await response.json();
  assert.equal(body.prUrl, existing);
  assert.equal(gh.trees.length, 0);
  assert.equal(gh.calls.some((call) => call.startsWith("POST /repos/omnifinn/plebflix-tv/git")), false);

  const refused = await handleSubmit(post({ url: "https://example.com/other" }, "1.1.1.1"), env(shelf, gh, { GITHUB_REPO: "other/repo" }));
  const no = await refused.json();
  assert.equal(no.prOpened, false);
  assert.match(no.message, /not pointed at this repo/);
  assert.equal(shelf.rows.length, 2);
});

test("a transient GitHub 502 is retried once inside the same filing", async () => {
  resetSubmissionLimiterForTests();
  const shelf = db();
  const gh = githubMock({ failPulls: 1 });
  const response = await handleSubmit(post({ url: "https://vimeo.com/1234567" }, "4.4.4.4"), env(shelf, gh));
  const body = await response.json();
  assert.equal(body.prOpened, true);
  assert.equal(gh.pulls(), 2);
  assert.equal(shelf.rows.length, 1);
});

test("status copy never claims a pull request that was not opened", () => {
  for (const reason of ["no-token", "repo", "github"]) {
    const message = recStatusMessage({ reason }, { duplicate: false });
    assert.doesNotMatch(message, /pull request is open/);
    assert.match(message, /No pull request was opened|did not open a pull request/);
  }
  const doc = reviewDocument({ id: "933e868f-3cd5-4ba2-ab8a-942ac624e6bb", url: YOUTUBE, channel: "international", created_at: "2026-11-07T13:34:52.094Z", title: "" });
  assert.equal(doc.approved, false);
  assert.equal(doc.on_air, false);
  assert.equal(doc.claimed, undefined);
  assert.equal(doc.embed_id, "vH-KXk8PZc8");
});

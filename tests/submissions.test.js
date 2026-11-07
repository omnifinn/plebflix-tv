import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, parseSubmission, resetSubmissionLimiterForTests } from "../lib/submissions.mjs";

function fakeDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.startsWith("SELECT COUNT")) return { n: rows.filter((r) => r.ip_hash === args[0] && r.created_at > args[1]).length };
          return null;
        },
        async all() {
          if (!sql.startsWith("SELECT id")) return { results: [] };
          const video = args[1];
          return { results: rows.filter((r) => r.url === args[0] || (video && r.url.includes(video))) };
        },
        async run() {
          if (sql.startsWith("UPDATE")) {
            const row = rows.find((r) => r.id === args[1]);
            if (row && !row.pr_url) row.pr_url = args[0];
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
const post = (body, ip = "1.2.3.4") => new Request("https://plebflix.com/api/recommend", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });

test("parse accepts any https video page and rejects junk", () => {
  assert.equal(parseSubmission({ channel: "suomi", url: "https://www.riemurasia.net/video/x" }).ok, true);
  // A bare link is a complete card; the channel falls back to International.
  const bare = parseSubmission({ url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(bare.ok, true);
  assert.equal(bare.submission.channel, "international");
  assert.equal(bare.submission.year, null);
  assert.equal(parseSubmission({ channel: "mars", url: "https://x.y" }).ok, true);
  assert.equal(parseSubmission({ channel: "suomi", url: "ftp://x" }).ok, false);
  assert.equal(parseSubmission({ channel: "suomi", url: "https://x.y", year: new Date().getUTCFullYear() }).ok, false);
});

test("a submission lands in D1 as pending, duplicates are folded", async () => {
  resetSubmissionLimiterForTests();
  const env = { DB: fakeDb() };
  const r = await handleSubmit(post({ channel: "international", url: "https://youtu.be/dQw4w9WgXcQ", year: 1987, submitter: "Niko", signals: ["b", "c", "a"] }), env);
  assert.equal(r.status, 201);
  const saved = await r.json();
  assert.equal(saved.saved, true);
  assert.equal(saved.prOpened, false);
  assert.equal(saved.prUrl, null);
  assert.match(saved.message, /No pull request was opened/);
  assert.doesNotMatch(saved.message, /pull request is open/);
  assert.equal(env.DB.rows[0].signals, "a,b,c");
  assert.equal(env.DB.rows[0].status, "pending");
  const d = await handleSubmit(post({ channel: "international", url: "https://youtu.be/dQw4w9WgXcQ" }), env);
  const again = await d.json();
  assert.equal(again.duplicate, true);
  assert.equal(again.prOpened, false);
  assert.match(again.message, /No pull request was opened/);
  assert.equal(env.DB.rows.length, 1);
});

test("rate limit trips after eight filings an hour", async () => {
  resetSubmissionLimiterForTests();
  const env = { DB: fakeDb() };
  for (let i = 0; i < 8; i++) assert.equal((await handleSubmit(post({ channel: "suomi", url: `https://example.com/${i}` }, "9.9.9.9"), env)).status, 201);
  assert.equal((await handleSubmit(post({ channel: "suomi", url: "https://example.com/x" }, "9.9.9.9"), env)).status, 429);
});

test("a shelf that does not answer is a 502 in the deck's words, not a crash", async () => {
  resetSubmissionLimiterForTests();
  const env = { DB: { prepare() { return { bind() { return this; }, async first() { throw new Error("D1_ERROR: storage"); }, async run() { throw new Error("D1_ERROR"); } }; } } };
  const r = await handleSubmit(post({ channel: "suomi", url: "https://example.com/tape" }, "7.7.7.7"), env);
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /shelf/);
});

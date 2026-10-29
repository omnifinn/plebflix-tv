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
          if (sql.startsWith("SELECT id")) return rows.find((r) => r.url === args[0]) || null;
          return null;
        },
        async run() {
          const [id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at] = args;
          rows.push({ id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at, status: "pending" });
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
  assert.equal(parseSubmission({ channel: "suomi", url: "ftp://x" }).ok, false);
  assert.equal(parseSubmission({ channel: "mars", url: "https://x.y" }).ok, false);
  assert.equal(parseSubmission({ channel: "suomi", url: "https://x.y", year: new Date().getUTCFullYear() }).ok, false);
});

test("a submission lands in D1 as pending, duplicates are folded", async () => {
  resetSubmissionLimiterForTests();
  const env = { DB: fakeDb() };
  const r = await handleSubmit(post({ channel: "international", url: "https://youtu.be/dQw4w9WgXcQ", year: 1987, submitter: "Niko", signals: ["b", "c", "a"] }), env);
  assert.equal(r.status, 201);
  assert.match((await r.json()).message, /Tape received/);
  assert.equal(env.DB.rows[0].signals, "a,b,c");
  const d = await handleSubmit(post({ channel: "international", url: "https://youtu.be/dQw4w9WgXcQ" }), env);
  assert.equal((await d.json()).duplicate, true);
  assert.equal(env.DB.rows.length, 1);
});

test("rate limit trips after eight filings an hour", async () => {
  resetSubmissionLimiterForTests();
  const env = { DB: fakeDb() };
  for (let i = 0; i < 8; i++) assert.equal((await handleSubmit(post({ channel: "suomi", url: `https://example.com/${i}` }, "9.9.9.9"), env)).status, 201);
  assert.equal((await handleSubmit(post({ channel: "suomi", url: "https://example.com/x" }, "9.9.9.9"), env)).status, 429);
});

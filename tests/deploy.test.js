import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { statementsOf } from "../scripts/deploy.mjs";

test("publish metadata keeps plain-text bindings", () => {
  const src = readFileSync("scripts/deploy.mjs", "utf8");
  const match = src.match(/keep_bindings:\s*(\[[^\]]+\])/);
  assert.ok(match, "publish metadata sets keep_bindings");
  const types = JSON.parse(match[1]);
  assert.ok(types.includes("plain_text"));
  assert.ok(types.includes("secret_text"));
  assert.ok(types.includes("secret_key"));
});

test("migrations split into statements without comments", () => {
  const sql = "-- a comment; with a semicolon\nCREATE TABLE t (a TEXT);\n\n-- another\nCREATE INDEX i ON t (a);\n";
  assert.deepEqual(statementsOf(sql), ["CREATE TABLE t (a TEXT)", "CREATE INDEX i ON t (a)"]);
});

test("deploy does not upload or verify hosted media", () => {
  const src = readFileSync("scripts/deploy.mjs", "utf8");
  assert.equal(src.includes("ingest.mjs"), false);
  assert.equal(src.includes("/media/suomi/b5mies.mp4"), false);
  assert.match(src, /refusing to upload hosted media/);
  assert.match(src, /\/credits/);
  assert.match(src, /takedown@plebflix.com/);
  const worker = readFileSync("src/worker.ts", "utf8");
  assert.equal(worker.includes("serveMedia"), false);
  assert.equal(worker.includes('"/media/"'), false);
  assert.match(worker, /\/credits\.html/);
});

test("every checked-in migration yields statements the connector step can run", () => {
  const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
  assert.ok(files.includes("0003_votes_ip.sql"));
  for (const name of files) {
    const statements = statementsOf(readFileSync(`migrations/${name}`, "utf8"));
    assert.ok(statements.length >= 1, name);
    for (const sql of statements) assert.match(sql, /^(CREATE|ALTER|INSERT|UPDATE|DROP)\b/i, `${name}: ${sql.slice(0, 40)}`);
  }
  assert.deepEqual(statementsOf(readFileSync("migrations/0003_votes_ip.sql", "utf8")), [
    "ALTER TABLE votes ADD COLUMN ip_hash TEXT",
    "CREATE INDEX IF NOT EXISTS votes_item_ip ON votes (item_id, ip_hash)",
  ]);
});

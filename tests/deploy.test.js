import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { statementsOf } from "../scripts/deploy.mjs";

test("migrations split into statements without comments", () => {
  const sql = "-- a comment; with a semicolon\nCREATE TABLE t (a TEXT);\n\n-- another\nCREATE INDEX i ON t (a);\n";
  assert.deepEqual(statementsOf(sql), ["CREATE TABLE t (a TEXT)", "CREATE INDEX i ON t (a)"]);
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

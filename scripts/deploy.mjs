#!/usr/bin/env node
// Plebflix TV deploy without wrangler login / API tokens.
// The Cloudflare *connector* (user-Cloudflare → execute, held by Page) does the authenticated calls;
// this script does everything else on the box. Protocol: LIBRARIAN.md "Ship protocol".
//
//   0. node scripts/deploy.mjs ship
//        → refuses unless main is clean and on GitHub; runs validate + tests, then `prepare`
//   0b. Run dist/deploy/step0-migrate.js through the connector → applies D1 migrations not yet in d1_migrations
//   1. node scripts/deploy.mjs prepare            (ship runs it)
//        → builds, writes dist/deploy/manifest.json, step0-migrate.js and step1-session.js
//   2. Run dist/deploy/step1-session.js through the connector's `execute` (account f7b1f5882ab68d7dfd785ad6942b2db2),
//      save its JSON result to dist/deploy/session.json  ({ jwt, buckets })
//   3. node scripts/deploy.mjs upload dist/deploy/session.json
//        → uploads only the new/changed asset files with the session JWT (no account token needed),
//          writes dist/deploy/step3-publish.js
//   4. Run dist/deploy/step3-publish.js through the connector's `execute` → publishes worker + assets.
//   5. node scripts/deploy.mjs verify   (smoke-checks https://plebflix.com)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = "f7b1f5882ab68d7dfd785ad6942b2db2";
const SCRIPT = "plebflix-tv";
const DB_ID = "bc743ec1-07f3-422b-bb5a-972aa6507996";
const ASSETS = path.join(ROOT, "dist/assets");
const OUT = path.join(ROOT, "dist/deploy");
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/vnd.microsoft.icon", ".webmanifest": "application/manifest+json", ".md": "text/markdown",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
};
const IGNORE = new Set(["/_headers", "/_redirects", "/.assetsignore"]);
const MAX_FILE = 25 * 1024 * 1024;
const MAX_BATCH = 40 * 1024 * 1024; // base64 bytes per upload request

async function hasher() {
  const { hash } = await import(pathToFileURL(path.join(ROOT, "node_modules/blake3-wasm/dist/index.js")).href);
  return hash;
}

function walk() {
  return fs.readdirSync(ASSETS, { recursive: true })
    .map((rel) => ({ rel, fp: path.join(ASSETS, rel) }))
    .filter(({ fp }) => fs.statSync(fp).isFile())
    .map(({ rel, fp }) => ({ fp, p: "/" + rel.split(path.sep).join("/") }))
    .filter(({ p }) => !IGNORE.has(p));
}

async function manifest() {
  const hash = await hasher();
  const out = {};
  const byHash = {};
  for (const { fp, p } of walk()) {
    const size = fs.statSync(fp).size;
    if (size > MAX_FILE) throw new Error(`${p} is over 25 MiB`);
    const ext = path.extname(fp);
    // Same hash recipe as wrangler: blake3(base64(content) + extension-without-dot), first 32 hex chars.
    const h = hash(fs.readFileSync(fp).toString("base64") + ext.slice(1)).toString("hex").slice(0, 32);
    out[p] = { hash: h, size };
    byHash[h] = { fp, type: MIME[ext.toLowerCase()] || "application/octet-stream" };
  }
  return { manifest: out, byHash };
}

async function prepare() {
  execSync("node scripts/build.mjs", { cwd: ROOT, stdio: "inherit" });
  fs.mkdirSync(OUT, { recursive: true });
  const { manifest: m } = await manifest();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(m));
  const code = `async () => {
  const manifest = ${JSON.stringify(m)};
  const s = await cloudflare.request({ method: "POST", path: \`/accounts/\${accountId}/workers/scripts/${SCRIPT}/assets-upload-session\`, body: { manifest } });
  return { jwt: s.result.jwt, buckets: s.result.buckets || [] };
}`;
  fs.writeFileSync(path.join(OUT, "step1-session.js"), code);
  fs.writeFileSync(path.join(OUT, "step0-migrate.js"), migrateCode());
  const hosted = Object.keys(m).filter((p) => p.startsWith("/media/"));
  if (hosted.length) throw new Error(`refusing to upload hosted media (${hosted.length} files)`);
  const bytes = Object.values(m).reduce((a, b) => a + b.size, 0);
  console.log(`${Object.keys(m).length} files, ${(bytes / 1048576).toFixed(1)} MiB`);
  console.log("→ connector: run dist/deploy/step0-migrate.js, then dist/deploy/step1-session.js (save its JSON as dist/deploy/session.json)");
}

/** Split a migration file into statements: drop `--` comment lines, cut on `;`. (Our migrations hold no `;` in strings.) */
export function statementsOf(sql) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Connector function: apply every migrations/*.sql not yet recorded in d1_migrations, in order, and record it. */
function migrateCode() {
  const migrations = fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, statements: statementsOf(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8")) }));
  return `async () => {
  const MIGRATIONS = ${JSON.stringify(migrations)};
  const q = async (sql, params = []) => {
    const r = await cloudflare.request({ method: "POST", path: \`/accounts/\${accountId}/d1/database/${DB_ID}/query\`, body: { sql, params } });
    if (r && r.success === false) throw new Error(JSON.stringify(r.errors));
    return (r && r.result && r.result[0] && r.result[0].results) || [];
  };
  await q("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const done = new Set((await q("SELECT name FROM d1_migrations")).map((row) => row.name));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    for (const sql of m.statements) {
      try {
        await q(sql);
      } catch (e) {
        // A column added by hand before the migration was recorded: treat as applied.
        if (!/duplicate column/i.test(String((e && e.message) || e))) throw new Error(m.name + ": " + ((e && e.message) || e));
      }
    }
    await q("INSERT INTO d1_migrations (name) VALUES (?)", [m.name]);
    applied.push(m.name);
  }
  return { applied, alreadyApplied: [...done] };
}`;
}

/** Box side of a deploy: only a clean main that GitHub already holds, only after the data gate and the tests pass. */
async function ship() {
  const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
  if (out("git rev-parse --abbrev-ref HEAD") !== "main") throw new Error("ship runs from main");
  if (out("git status --porcelain --untracked-files=no")) throw new Error("uncommitted changes: commit and push first");
  run("git fetch -q origin main");
  const head = out("git rev-parse HEAD");
  if (head !== out("git rev-parse origin/main")) throw new Error("main is not what GitHub holds: push (or pull) first");
  run("npm run validate");
  run("npm test");
  run("node scripts/resources.mjs --check");
  await prepare();
  fs.writeFileSync(path.join(OUT, "ship.json"), JSON.stringify({ commit: head, build: JSON.parse(fs.readFileSync(path.join(ASSETS, "channels/index.json"), "utf8")).build, at: new Date().toISOString() }));
  console.log(`ship ready for ${head.slice(0, 7)}`);
}

async function upload(sessionFile) {
  const raw = fs.readFileSync(sessionFile, "utf8");
  const sess = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const { byHash } = await manifest();
  let jwt = sess.jwt;
  const hashes = (sess.buckets || []).flat();
  console.log(`${hashes.length} files to upload`);
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const fd = new FormData();
    for (const h of batch) fd.append(h, new File([fs.readFileSync(byHash[h].fp).toString("base64")], h, { type: byHash[h].type }), h);
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/assets/upload?base64=true`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (j.success) { if (j.result?.jwt) jwt = j.result.jwt; break; }
      if (attempt >= 3) throw new Error(`upload failed ${r.status} ${JSON.stringify(j.errors)}`);
    }
    process.stdout.write(`.`);
    batch = []; size = 0;
  };
  for (const h of hashes) {
    if (!byHash[h]) throw new Error(`server asked for unknown hash ${h}`);
    const s = Math.ceil(fs.statSync(byHash[h].fp).size * 4 / 3);
    if (size + s > MAX_BATCH) await flush();
    batch.push(h); size += s;
  }
  await flush();
  console.log("\nuploaded");
  const worker = fs.readFileSync(path.join(ROOT, "dist/worker.js"), "utf8");
  const headers = fs.readFileSync(path.join(ASSETS, "_headers"), "utf8");
  const metadata = {
    main_module: "worker.js", compatibility_date: "2026-10-29", compatibility_flags: [],
    bindings: [{ type: "d1", name: "DB", id: DB_ID }, { type: "assets", name: "ASSETS" },
      // Free edge rate limits (Workers Rate Limiting binding): per IP, per Cloudflare location, per 60 s.
      { type: "ratelimit", name: "REC_RL", namespace_id: "4101", simple: { limit: 3, period: 60 } },
      { type: "ratelimit", name: "VOTE_RL", namespace_id: "4102", simple: { limit: 30, period: 60 } },
      { type: "ratelimit", name: "PLAY_RL", namespace_id: "4103", simple: { limit: 30, period: 60 } }],
    observability: { enabled: true, traces: { enabled: true } },
    // Without this a script upload drops every binding not listed above, so a secret (IP_SALT) or a plain-text var (GITHUB_REPO) would vanish each deploy.
    keep_bindings: ["secret_text", "secret_key", "plain_text"],
    assets: { jwt, config: { run_worker_first: ["/api/*", "/suomi", "/suomi/", "/credits", "/credits/", "/takedown", "/takedown/"], _headers: headers } },
  };
  const code = `async () => {
  const metadata = ${JSON.stringify(metadata)};
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([${JSON.stringify(worker)}], { type: "application/javascript+module" }), "worker.js");
  const p = await cloudflare.request({ method: "PUT", path: \`/accounts/\${accountId}/workers/scripts/${SCRIPT}\`, body: form });
  return { success: p.success, id: p.result && p.result.id, etag: p.result && p.result.etag, has_assets: p.result && p.result.has_assets, errors: p.errors };
}`;
  fs.writeFileSync(path.join(OUT, "step3-publish.js"), code);
  console.log(`→ run dist/deploy/step3-publish.js via the connector (${(code.length / 1024).toFixed(0)} KiB)`);
}

async function verify() {
  const base = process.env.PLEBFLIX_URL || "https://plebflix.com";
  let failed = 0;
  const check = (ok, line) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) failed += 1;
  };
  for (const p of ["/", "/channels/suomi.json", "/channels/schedule.json", "/credits", "/takedown", "/api/stats?channel=suomi"]) {
    const r = await fetch(base + p);
    check(r.ok, `${r.status} ${p} ${r.headers.get("content-type") || ""}`);
  }
  const credits = await (await fetch(`${base}/credits?verify=${Date.now()}`)).text();
  check(credits.includes("embedded via YouTube") || credits.includes("Credits"), "credits page lists the tapes");
  const takedown = await (await fetch(`${base}/takedown?verify=${Date.now()}`)).text();
  check(takedown.includes("takedown@plebflix.com"), "takedown page names takedown@plebflix.com");
  // The live shell must load the app.js that carries this build's deck (glass click pauses / plays on).
  const html = await (await fetch(`${base}/?verify=${Date.now()}`)).text();
  const appUrl = (html.match(/src="(\/app\.js\?v=[a-f0-9]+)"/) || [])[1];
  check(Boolean(appUrl), `shell references a versioned app.js (${appUrl || "none"})`);
  if (appUrl) {
    const app = await (await fetch(base + appUrl)).text();
    check(app.includes('$("screen").addEventListener("click"'), "live app.js: a click on the glass pauses and plays on");
    check(app.includes("shiftKind"), "live app.js: CONTINUOUS / TIMESHIFT modes");
  }
  // This exact build is live: the catalog stamp the deck polls matches the one built here.
  const live = await (await fetch(`${base}/channels/index.json?verify=${Date.now()}`)).json().catch(() => ({}));
  const localFile = path.join(ASSETS, "channels/index.json");
  const local = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, "utf8")).build : "";
  check(Boolean(live.build) && (!local || live.build === local), `catalog build stamp live ${live.build || "none"} / built here ${local || "none"}`);
  if (failed) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("verify: all checks passed");
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (cmd === "ship") await ship();
  else if (cmd === "prepare") await prepare();
  else if (cmd === "upload") await upload(arg || path.join(OUT, "session.json"));
  else if (cmd === "verify") await verify();
  else console.log("usage: node scripts/deploy.mjs ship | prepare | upload <session.json> | verify");
}

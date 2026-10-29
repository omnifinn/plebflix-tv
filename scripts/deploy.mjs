#!/usr/bin/env node
// Plebflix TV deploy without wrangler login / API tokens.
// The Cloudflare *connector* (user-Cloudflare → execute) does the two authenticated calls;
// this script does everything else on the box.
//
//   1. node scripts/deploy.mjs prepare
//        → builds, writes dist/deploy/manifest.json and dist/deploy/step1-session.js
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
  execSync("node scripts/ingest.mjs --check", { cwd: ROOT, stdio: "inherit" });
  fs.mkdirSync(OUT, { recursive: true });
  const { manifest: m } = await manifest();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(m));
  const code = `async () => {
  const manifest = ${JSON.stringify(m)};
  const s = await cloudflare.request({ method: "POST", path: \`/accounts/\${accountId}/workers/scripts/${SCRIPT}/assets-upload-session\`, body: { manifest } });
  return { jwt: s.result.jwt, buckets: s.result.buckets || [] };
}`;
  fs.writeFileSync(path.join(OUT, "step1-session.js"), code);
  const bytes = Object.values(m).reduce((a, b) => a + b.size, 0);
  console.log(`${Object.keys(m).length} files, ${(bytes / 1048576).toFixed(1)} MiB → run dist/deploy/step1-session.js via the connector`);
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
    bindings: [{ type: "d1", name: "DB", id: DB_ID }, { type: "plain_text", name: "GITHUB_REPO", text: "omnifinn/plebflix-tv" }, { type: "assets", name: "ASSETS" },
      // Free edge rate limits (Workers Rate Limiting binding): per IP, per Cloudflare location, per 60 s.
      { type: "ratelimit", name: "REC_RL", namespace_id: "4101", simple: { limit: 3, period: 60 } },
      { type: "ratelimit", name: "VOTE_RL", namespace_id: "4102", simple: { limit: 30, period: 60 } },
      { type: "ratelimit", name: "PLAY_RL", namespace_id: "4103", simple: { limit: 30, period: 60 } }],
    observability: { enabled: true, traces: { enabled: true } },
    assets: { jwt, config: { run_worker_first: ["/api/*", "/media/*", "/suomi", "/suomi/"], _headers: headers } },
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
  for (const p of ["/", "/app.js", "/channels/suomi.json", "/media/intro/winamp-intro.mp4", "/api/stats?channel=suomi"]) {
    const r = await fetch(base + p, { headers: p.startsWith("/media") ? { Range: "bytes=0-1023" } : {} });
    console.log(r.status, p, r.headers.get("content-type"), r.headers.get("content-range") || "");
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "prepare") await prepare();
else if (cmd === "upload") await upload(arg || path.join(OUT, "session.json"));
else if (cmd === "verify") await verify();
else console.log("usage: node scripts/deploy.mjs prepare | upload <session.json> | verify");

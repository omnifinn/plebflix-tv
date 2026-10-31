import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { buildLineup } from "../lib/lineup.mjs";
import { applyShareHead } from "../lib/share-head.mjs";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function build() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist/assets", { recursive: true });
  await esbuild.build({
    entryPoints: ["src/worker.ts"],
    outfile: "dist/worker.js",
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    legalComments: "none",
  });
  await cp("public", "dist/assets", { recursive: true });
  // Every script and stylesheet the shell loads gets a content hash in its URL, so a browser that holds an older
  // app.js can never run it against a newer index.html (the files are cached for a year under _headers).
  const versions = await versionAssets();
  // Share card / favicon / theme-color tags come from share.config.json (one place to swap them).
  const share = JSON.parse(await readFile("share.config.json", "utf8"));
  let shell = applyShareHead(await readFile("public/index.html", "utf8"), share, "intl");
  for (const [file, v] of versions) shell = shell.replaceAll(`"/${file}"`, `"/${file}?v=${v}"`);
  await writeFile("dist/assets/index.html", shell);
  await mkdir("dist/assets/channels", { recursive: true });
  await cp("channels", "dist/assets/channels", { recursive: true });
  const read = async (f) => JSON.parse(await readFile(f, "utf8"));
  const lineup = buildLineup({ suomi: await read("channels/suomi.json"), international: await read("channels/international.json") }, await read("channels/categories.json"));
  // `build` names this catalog + schedule + generator. An open tab polls it and re-reads the data when it changes,
  // so a deploy never leaves two viewers on two lineups for the rest of the day.
  const stamp = createHash("sha256");
  for (const file of ["channels/suomi.json", "channels/international.json", "channels/categories.json", "channels/schedule.json", "public/schedule.js"]) stamp.update(await readFile(file));
  await writeFile("dist/assets/channels/index.json", JSON.stringify({ build: stamp.digest("hex").slice(0, 12), langs: lineup.langs, channels: lineup.index }));
  for (const [id, doc] of Object.entries(lineup.cats)) await writeFile(`dist/assets/channels/${id}.json`, JSON.stringify(doc));
  await cp("RESOURCES.md", "dist/assets/RESOURCES.md").catch(() => {});
  // The REC dialog checks pasted links against the archive shelf hosts.
  await cp("sources.json", "dist/assets/sources.json").catch(() => {});
  // Temporary source hand-off for a cloud agent (gitignored; remove the folder to stop serving it).
  if (existsSync(".handoff")) await cp(".handoff", "dist/assets/_handoff", { recursive: true });
}

/** Hash the shell's scripts and styles in dist/assets; rewrite app.js's own import first so its hash covers it. */
async function versionAssets() {
  const short = (text) => createHash("sha256").update(text).digest("hex").slice(0, 10);
  const files = ["schedule.js", "play.js", "fx.js", "audio.js", "search.js", "skins.js", "tactile.js", "styles.css", "styles/tokens.css"];
  const versions = new Map();
  for (const file of files) versions.set(file, short(await readFile(`dist/assets/${file}`)));
  let app = (await readFile("dist/assets/app.js", "utf8"))
    .replace('from "./schedule.js"', `from "./schedule.js?v=${versions.get("schedule.js")}"`)
    .replace('from "./play.js"', `from "./play.js?v=${versions.get("play.js")}"`);
  await writeFile("dist/assets/app.js", app);
  versions.set("app.js", short(app));
  return versions;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}

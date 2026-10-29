import * as esbuild from "esbuild";
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
  // Share card / favicon / theme-color tags come from share.config.json (one place to swap them).
  const share = JSON.parse(await readFile("share.config.json", "utf8"));
  await writeFile("dist/assets/index.html", applyShareHead(await readFile("public/index.html", "utf8"), share, "intl"));
  await mkdir("dist/assets/channels", { recursive: true });
  await cp("channels", "dist/assets/channels", { recursive: true });
  const read = async (f) => JSON.parse(await readFile(f, "utf8"));
  const lineup = buildLineup({ suomi: await read("channels/suomi.json"), international: await read("channels/international.json") }, await read("channels/categories.json"));
  await writeFile("dist/assets/channels/index.json", JSON.stringify({ langs: lineup.langs, channels: lineup.index }));
  for (const [id, doc] of Object.entries(lineup.cats)) await writeFile(`dist/assets/channels/${id}.json`, JSON.stringify(doc));
  await cp("RESOURCES.md", "dist/assets/RESOURCES.md").catch(() => {});
  // The REC dialog checks pasted links against the archive shelf hosts.
  await cp("sources.json", "dist/assets/sources.json").catch(() => {});
  // Self-hosted tapes live outside git in media/ (or $PLEBFLIX_MEDIA); copy them in.
  const media = process.env.PLEBFLIX_MEDIA || "media";
  if (existsSync(media)) await cp(media, "dist/assets/media", { recursive: true });
  // Temporary source hand-off for a cloud agent (gitignored; remove the folder to stop serving it).
  if (existsSync(".handoff")) await cp(".handoff", "dist/assets/_handoff", { recursive: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}

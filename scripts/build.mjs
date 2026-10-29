import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
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
  await mkdir("dist/assets/channels", { recursive: true });
  await cp("channels", "dist/assets/channels", { recursive: true });
  await cp("RESOURCES.md", "dist/assets/RESOURCES.md").catch(() => {});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}

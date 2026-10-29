import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { build } from "./build.mjs";

await build();

const child = spawn("npx", ["wrangler", "dev"], { stdio: "inherit" });

let timer;
const rebuild = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    build().catch((error) => console.error(error));
  }, 80);
};

for (const dir of ["src", "lib", "public", "channels"]) {
  watch(dir, { recursive: true }, rebuild);
}
watch("RESOURCES.md", rebuild);

const stop = () => {
  child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));

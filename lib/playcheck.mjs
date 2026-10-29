import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export const CONTROL_ID = "dQw4w9WgXcQ";

const PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <title>waiting</title>
</head>
<body>
  <div id="player"></div>
  <script>
    const id = new URLSearchParams(location.search).get("v");
    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      document.title = "PLAYCHECK " + JSON.stringify(result);
    }
    window.onYouTubeIframeAPIReady = function () {
      new YT.Player("player", {
        width: "640",
        height: "360",
        videoId: id,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, origin: location.origin, rel: 0 },
        events: {
          onReady(event) { event.target.mute(); event.target.playVideo(); },
          onStateChange(event) {
            if (event.data === YT.PlayerState.PLAYING) {
              const duration = Math.round(event.target.getDuration() || 0);
              finish({ ok: duration > 0, duration, code: duration > 0 ? "" : "noduration" });
            }
          },
          onError(event) { finish({ ok: false, code: event.data }); }
        }
      });
    };
    setTimeout(() => finish({ ok: false, code: "timeout" }), 12000);
  </script>
  <script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>`;

/**
 * Rick Astley's upload has to play inside a real page before the shelf changes.
 * A bare youtube-nocookie URL returns error 153 and is not a valid check.
 */
export async function proveControl() {
  const [result] = await checkYoutube([CONTROL_ID], { concurrency: 1 });
  if (!result?.ok) {
    throw new Error(`Playcheck control failed (${result?.code || "no result"}). The shelf was not changed.`);
  }
  return result;
}

/**
 * @param {string[]} ids
 * @param {{ concurrency?: number, timeoutMs?: number }} [options]
 */
export async function checkYoutube(ids, { concurrency = 3, timeoutMs = 15000 } = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const server = await listen();
  const chrome = await launchChrome();
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  const workers = Math.min(concurrency, unique.length);
  /** @type {Array<{ id: string, ok: boolean, duration?: number, code?: string | number }>} */
  const results = [];
  let cursor = 0;
  try {
    const pages = [];
    for (let index = 0; index < workers; index += 1) {
      pages.push(await openPage(chrome.port));
    }
    await Promise.all(
      pages.map(async (page) => {
        while (cursor < unique.length) {
          const id = unique[cursor];
          cursor += 1;
          const url = `http://localhost:${address.port}/playcheck.html?v=${encodeURIComponent(id)}`;
          const result = await readPage(page.ws, url, timeoutMs, chrome.port);
          results.push({ id, ...result });
          process.stderr.write(`${result.ok ? "play" : "skip"} ${id} ${result.ok ? result.duration : result.code}\n`);
        }
        page.ws.close();
      }),
    );
  } finally {
    chrome.child.kill("SIGKILL");
    server.close();
  }
  return results;
}

function listen() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function launchChrome() {
  const port = 9400 + Math.floor(Math.random() * 200);
  const chrome = process.env.CHROME || "/usr/bin/google-chrome";
  const headed = Boolean(process.env.DISPLAY) && process.env.PLAYCHECK_HEADLESS !== "1";
  const child = spawn(
    chrome,
    [
      headed ? "--start-maximized" : "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/plebflix-playcheck-${process.pid}-${port}`,
      "--no-first-run",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: "ignore", env: { ...process.env, DISPLAY: process.env.DISPLAY || "" } },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return { child, port };
    } catch {
      /* chrome is still starting */
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error("Chrome did not open a debugging port.");
}

/** @param {number} port */
async function openPage(port) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!created.ok) throw new Error(`Chrome did not open a tab (${created.status}).`);
  const page = await created.json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await rpc(ws, "Runtime.enable");
  return { ws };
}

/**
 * @param {WebSocket} ws
 * @param {string} url
 * @param {number} timeoutMs
 * @param {number} port
 */
async function readPage(ws, url, timeoutMs, port) {
  await rpc(ws, "Page.enable").catch(() => {});
  await rpc(ws, "Page.navigate", { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await rpc(ws, "Runtime.evaluate", { expression: "document.title", returnByValue: true });
    const title = value?.result?.value || "";
    if (typeof title === "string" && title.startsWith("PLAYCHECK ")) {
      try {
        const result = JSON.parse(title.slice("PLAYCHECK ".length));
        if (!result.ok) result.code = (await botWall(port)) || result.code;
        return result;
      } catch {
        return { ok: false, code: "badtitle" };
      }
    }
    await delay(400);
  }
  return { ok: false, code: "timeout" };
}

/**
 * YouTube answers a datacenter embed with error 150 and a sign-in wall.
 * That is not the owner disabling playback.
 * @param {number} port
 */
async function botWall(port) {
  let list = [];
  try {
    list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  } catch {
    return "";
  }
  const frame = (list || []).find((target) => /youtube/.test(target.url || "") && target.webSocketDebuggerUrl);
  if (!frame) return "";
  const ws = new WebSocket(frame.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const value = await rpc(ws, "Runtime.evaluate", {
      expression: "document.body ? document.body.innerText.slice(0, 400) : ''",
      returnByValue: true,
    });
    const text = String(value?.result?.value || "");
    if (/not a bot|sign in to confirm/i.test(text)) return "bot";
  } catch {
    return "";
  } finally {
    ws.close();
  }
  return "";
}

/**
 * @param {WebSocket} ws
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 */
function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message || method));
      else resolve(message.result || {});
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

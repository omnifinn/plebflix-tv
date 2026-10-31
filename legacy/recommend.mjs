// LEGACY (moved from lib/ on 2026-10-30): the REC route that opened a GitHub pull request straight from the
// Worker. Replaced by lib/submissions.mjs (REC → D1 `submissions`, the librarian opens the PR). Kept with its
// test for the link parsing it still documents; nothing in src/ imports it.
import { classicCutoff, validateChannel } from "../lib/schema.mjs";
import { renderResources } from "../lib/resources-md.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";
import sources from "../sources.json" with { type: "json" };

const CHANNELS = ["suomi", "international"];
const limiter = createRateLimiter();

export function resetLimiterForTests() {
  limiter.reset();
}

/**
 * @param {Request} request
 * @param {{ GITHUB_TOKEN?: string, GITHUB_REPO?: string, RATE_LIMIT?: { get: Function, put: Function } }} env
 */
export async function handleRecommend(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "The REC button only accepts POST." }, 405);
  }

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ ok: false, error: "That request came from outside the living room." }, 403);
      }
    } catch {
      return json({ ok: false, error: "That request came from outside the living room." }, 403);
    }
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > 8000) {
    return json({ ok: false, error: "That note is too long for the tape label." }, 413);
  }
  const text = await request.text();
  if (text.length > 8000) {
    return json({ ok: false, error: "That note is too long for the tape label." }, 413);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "The deck couldn't read that card." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "The deck couldn't read that card." }, 400);
  }
  if (Object.keys(body).length > 12) {
    return json({ ok: false, error: "The deck couldn't read that card." }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "local";
  const gate = await limiter.allow(ip.split(",")[0].trim() || "local", env.RATE_LIMIT);
  if (!gate.ok) {
    return json(
      { ok: false, error: "The deck is warm. Try another tape in a little while." },
      429,
      { "retry-after": String(gate.retryAfter || 3600) },
    );
  }

  if (body.company) {
    return json({ ok: true, message: "Got it. The tape is on the pile." });
  }

  const parsed = parseSuggestion(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

  const token = (env.GITHUB_TOKEN || "").trim();
  if (!token) {
    return json(
      {
        ok: false,
        error:
          "The tape deck has no GitHub token. Set the GITHUB_TOKEN Worker secret and recommendations will open a pull request.",
      },
      503,
    );
  }
  const repo = (env.GITHUB_REPO || "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return json({ ok: false, error: "GITHUB_REPO is not configured on this Worker." }, 503);
  }

  try {
    const prUrl = await openPullRequest(token, repo, parsed.suggestion);
    return json({
      ok: true,
      prUrl,
      message: "Filed. A librarian still has to check the embed before it airs.",
    });
  } catch (error) {
    const status = error instanceof GithubError ? error.status : 502;
    const message =
      error instanceof GithubError
        ? githubMessage(error)
        : "The deck jammed while talking to GitHub.";
    return json({ ok: false, error: message }, status >= 400 && status < 600 ? status : 502);
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export function parseSuggestion(body) {
  const channel = body.channel;
  if (channel !== "suomi" && channel !== "international") {
    return { ok: false, error: "Pick Suomi or International." };
  }
  if (typeof body.url !== "string" || body.url.length > 500) {
    return { ok: false, error: "Paste a video link." };
  }
  const extracted = extractEmbed(body.url.trim());
  if (!extracted) {
    return {
      ok: false,
      error: "Plebflix files YouTube, Vimeo, Internet Archive, and Wayback links, plus the other shelves in the tape library.",
    };
  }
  const cutoff = classicCutoff();
  const year = body.year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1970 || year > cutoff) {
    return { ok: false, error: `A classic has to be from ${cutoff} or earlier.` };
  }
  if (typeof body.why !== "string" || body.why.trim().length < 1 || body.why.length > 200 || /[\r\n]/.test(body.why)) {
    return { ok: false, error: "Say why it is a classic, in one line." };
  }
  const signals = readSignals(body.signals);
  if (!signals) {
    return { ok: false, error: "Pick at least three of the signals a, b, c, d, and e." };
  }
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 160)
      : extracted.embedId;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (typeof body.title === "string" && body.title.length > 160) {
    return { ok: false, error: "The title is too long for the label." };
  }
  if (typeof body.note === "string" && body.note.length > 500) {
    return { ok: false, error: "The note is too long for the sleeve." };
  }
  const suffix = randomSuffix();
  const page = body.url.trim();
  const suggestion = {
    id: `${slugify(title)}-${suffix}`,
    title,
    year,
    source: extracted.source,
    embedId: extracted.embedId,
    duration: 0,
    note,
    credit: page,
    signals,
    why: body.why.trim(),
    original_url: page,
    status: "pending",
    play: playFor(extracted, page),
    channel,
  };
  return { ok: true, suggestion };
}

/** @param {unknown} value */
function readSignals(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 5) return null;
  const allowed = ["a", "b", "c", "d", "e"];
  const signals = [];
  for (const signal of value) {
    if (typeof signal !== "string" || !allowed.includes(signal) || signals.includes(signal)) return null;
    signals.push(signal);
  }
  return signals;
}

/**
 * @param {string} raw
 */
export function extractEmbed(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host === "www.youtu.be"
  ) {
    let id = "";
    if (host.endsWith("youtu.be")) id = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") {
        id = parts[1] || "";
      }
    }
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) return null;
    return { source: "youtube", embedId: id };
  }
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[0] === "video" ? parts[1] : parts[0];
    if (!/^\d{5,12}$/.test(id || "")) return null;
    return { source: "vimeo", embedId: id };
  }
  if (host === "archive.org" || host === "www.archive.org") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[1] || "";
    if (
      ["details", "embed", "download"].includes(parts[0] || "") &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(id)
    ) {
      return { source: "archive.org", embedId: id };
    }
  }
  if (shelfHost(host)) {
    const embedId = `${url.origin}${url.pathname}${url.search}`;
    if (embedId.length > 500) return null;
    return { source: "other", embedId };
  }
  return null;
}

/** A pending card still has to carry `play`. Official is false until a person confirms the upload. */
function playFor(extracted, page) {
  if (extracted.source === "youtube") {
    return { kind: "youtube", id_or_url: extracted.embedId, official: false, uploader: "unknown" };
  }
  if (extracted.source === "archive.org") {
    return { kind: "archive", id_or_url: extracted.embedId, official: false, uploader: "unknown" };
  }
  return { kind: "link", id_or_url: page, official: false, uploader: "unknown" };
}

/** @param {string} host */
function shelfHost(host) {
  for (const shelf of sources.shelves) {
    for (const name of shelf.hosts) {
      if (host === name) return true;
      if (shelf.subdomains && (host === name || host.endsWith(`.${name}`))) return true;
    }
  }
  return false;
}

/**
 * @param {string} token
 * @param {string} repo
 * @param {any} suggestion
 */
async function openPullRequest(token, repo, suggestion) {
  const gh = github(token);
  const info = await gh(`/repos/${repo}`);
  const baseBranch = info.default_branch;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseSha = ref.object.sha;
  const commit = await gh(`/repos/${repo}/git/commits/${baseSha}`);
  const baseTree = commit.tree.sha;

  const docs = [];
  for (const id of CHANNELS) {
    const file = await gh(
      `/repos/${repo}/contents/channels/${id}.json?ref=${encodeURIComponent(baseBranch)}`,
    );
    const text = decodeBase64(file.content || "");
    docs.push(JSON.parse(text));
  }
  const index = CHANNELS.indexOf(suggestion.channel);
  const doc = docs[index];
  if (doc.items.some((item) => item.embedId === suggestion.embedId && item.source === suggestion.source)) {
    throw new GithubError(409, "That tape is already on the shelf.");
  }
  const credit = suggestion.credit;
  if (doc.items.some((item) => item.credit === credit)) {
    throw new GithubError(409, "That tape is already on the shelf.");
  }
  const { channel, ...item } = suggestion;
  doc.items.push(item);
  const check = validateChannel(doc, channel);
  if (!check.ok) {
    throw new GithubError(400, "The new card didn't pass the shelf check.");
  }

  const resources = renderResources(docs);
  const channelPath = `channels/${channel}.json`;
  const channelBody = `${JSON.stringify(doc, null, 2)}\n`;
  const channelBlob = await gh(`/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: channelBody, encoding: "utf-8" }),
  });
  const resourcesBlob = await gh(`/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: resources, encoding: "utf-8" }),
  });
  const tree = await gh(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTree,
      tree: [
        { path: channelPath, mode: "100644", type: "blob", sha: channelBlob.sha },
        { path: "RESOURCES.md", mode: "100644", type: "blob", sha: resourcesBlob.sha },
      ],
    }),
  });
  const next = await gh(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `REC: ${item.title}\n\nFiled from the Plebflix deck.`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });
  const branch = `rec/${channel}/${item.id}`;
  await gh(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: next.sha }),
  });
  try {
    const pr = await gh(`/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `REC: ${item.title} (${channel})`,
        head: branch,
        base: baseBranch,
        body: pullBody(item, channel),
      }),
    });
    return pr.html_url;
  } catch (error) {
    await gh(`/repos/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

/** @param {any} item @param {string} channel */
function pullBody(item, channel) {
  const claimed = new Set(item.signals || []);
  const signals = [
    ["a", "Born online"],
    ["b", "Spread widely"],
    ["c", "Still quoted or recognized"],
    ["d", "Amateur or DIY"],
    ["e", "Defined its scene"],
  ];
  return [
    "## REC",
    "",
    "A viewer filed this tape from the deck.",
    "",
    `| | |`,
    `| --- | --- |`,
    `| Title | ${item.title.replace(/\|/g, "\\|")} |`,
    `| Channel | ${channel} |`,
    `| Year | ${item.year} |`,
    `| Why | ${item.why.replace(/\|/g, "\\|")} |`,
    `| Original | ${item.original_url} |`,
    `| Link | ${item.credit} |`,
    `| Note | ${(item.note || "—").replace(/\|/g, "\\|")} |`,
    "",
    "Signals the viewer claimed. See `CLASSIC.md`. Leave a box empty when the claim does not hold:",
    "",
    ...signals.map(([letter, label]) => `- [${claimed.has(letter) ? "x" : " "}] (${letter}) ${label}`),
    "",
    "The entry is marked `\"status\": \"pending\"` with `duration: 0`. It is **not** in the live loop until this checklist is done:",
    "",
    "- [ ] Open the link and confirm a real embed plays inside the set",
    "- [ ] Set `play.uploader`, and `play.official` once you know whose upload it is",
    "- [ ] Set `duration` to the length in seconds",
    "- [ ] Remove `\"status\": \"pending\"`",
    "- [ ] Confirm it is not a duplicate",
    "- [ ] Keep `original_url` on the original upload or a Wayback snapshot",
    "- [ ] Confirm the year is at least ten years ago and at least three signals are honest",
    "",
    "Nothing is rehosted. Playback stays an embed.",
    "",
  ].join("\n");
}

/** @param {string} token */
function github(token) {
  return async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "plebflix-tv",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
    if (init.method === "DELETE" && (response.status === 204 || response.status === 404)) {
      return null;
    }
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { message: raw.slice(0, 240) };
      }
    }
    if (!response.ok) {
      throw new GithubError(response.status, payload?.message || response.statusText);
    }
    return payload;
  };
}

class GithubError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "GithubError";
  }
}

/** @param {GithubError} error */
function githubMessage(error) {
  if (error.status === 409) return error.message;
  if (error.status === 401 || error.status === 403) {
    return "GitHub refused the token. It needs contents and pull request access to this repo.";
  }
  if (error.status === 404) return "GitHub could not find the repo or the channel file.";
  return "GitHub did not accept the tape. Try again in a minute.";
}

/** @param {string} content */
function decodeBase64(content) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function randomSuffix() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} input */
function slugify(input) {
  const folded = input
    .toLowerCase()
    .replace(/[äå]/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/é/g, "e");
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "tape";
}

/** @param {unknown} data @param {number} status @param {Record<string, string>} [extra] */
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

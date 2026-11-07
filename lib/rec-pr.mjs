// REC → a real GitHub review pull request. The shelf is not edited here: a pasted link has
// not been vetted, so the pull request only adds rec-inbox/<id>.json. Nothing in that file is approved
// or on air. The token is sent only to api.github.com for the pinned repo.
export const REC_REPO = "omnifinn/plebflix-tv";
const REC_OWNER = "omnifinn";

export function pinnedRepo(env) {
  const configured = String(env?.GITHUB_REPO || REC_REPO).trim();
  return configured === REC_REPO ? REC_REPO : null;
}

/** Local parse only. The submitted URL is never fetched. */
export function videoRef(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
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
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") id = parts[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { source: "youtube", id };
  }
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[0] === "video" ? parts[1] : parts[0];
    if (!/^\d{5,12}$/.test(id || "")) return null;
    return { source: "vimeo", id };
  }
  if (host === "archive.org" || host === "www.archive.org") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[1] || "";
    if (["details", "embed", "download"].includes(parts[0] || "") && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(id)) {
      return { source: "archive.org", id };
    }
  }
  return null;
}

export function sameTape(left, right) {
  if (left && right && left === right) return true;
  const a = videoRef(left);
  const b = videoRef(right);
  return Boolean(a && b && a.source === b.source && a.id === b.id);
}

export function isOwnPull(url) {
  return /^https:\/\/github\.com\/omnifinn\/plebflix-tv\/pull\/\d+$/.test(String(url || ""));
}

export function reviewDocument(row) {
  const video = videoRef(row.url);
  const doc = {
    kind: "rec-inbox",
    approved: false,
    on_air: false,
    submission_id: row.id,
    channel: row.channel,
    url: row.url,
    created_at: row.created_at,
  };
  if (video) {
    doc.source = video.source;
    doc.embed_id = video.id;
  }
  const claimed = {};
  if (row.title) claimed.title = row.title;
  if (row.year != null && row.year !== "") claimed.year = row.year;
  if (row.why) claimed.why = row.why;
  if (row.note) claimed.note = row.note;
  if (row.signals) claimed.signals = row.signals;
  if (Object.keys(claimed).length) doc.claimed = claimed;
  return doc;
}

export function recStatusMessage(result, { duplicate = false } = {}) {
  if (result?.prUrl && isOwnPull(result.prUrl)) {
    return duplicate
      ? "Already recorded. The review pull request is open. It is not on air."
      : "Tape saved. A review pull request is open. It is not on air and not approved.";
  }
  if (result?.reason === "no-token") {
    return duplicate
      ? "Already recorded. No pull request was opened: this deck has no GitHub token."
      : "Tape saved. No pull request was opened: this deck has no GitHub token.";
  }
  if (result?.reason === "repo") {
    return "Tape saved. No pull request was opened: GitHub is not pointed at this repo.";
  }
  return duplicate
    ? "Already recorded. No pull request was opened. Send the same link again to retry."
    : "Tape saved. GitHub did not open a pull request. Send the same link again to retry.";
}

/**
 * Open the review pull request for a saved row, or return the one that already exists.
 * Does not edit channels/. Does not mark the row approved.
 * @param {{ GITHUB_TOKEN?: string, GITHUB_REPO?: string }} env
 * @param {{ id: string, url: string, channel: string, created_at: string, title?: string, year?: number|null, why?: string, note?: string, signals?: string }} row
 */
export async function ensureReviewPullRequest(env, row, fetchImpl = globalThis.fetch) {
  const repo = pinnedRepo(env);
  if (!repo) return { prOpened: false, reason: "repo", retryable: false };
  const token = String(env?.GITHUB_TOKEN || "").trim();
  if (!token) return { prOpened: false, reason: "no-token", retryable: true };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row?.id || "")) {
    return { prOpened: false, reason: "id", retryable: false };
  }
  const gh = github(token, fetchImpl);
  const video = videoRef(row.url);
  const markers = [`plebflix-submission:${row.id}`];
  if (video) markers.push(`plebflix-video:${video.id}`);
  for (const marker of markers) {
    const found = await searchOpen(gh, marker);
    if (found) return { prOpened: true, prUrl: found, reused: true };
  }

  const branch = `rec/${row.id}`;
  const info = await gh(`/repos/${repo}`);
  const base = info?.default_branch;
  if (typeof base !== "string" || !/^[A-Za-z0-9._/-]+$/.test(base)) {
    return { prOpened: false, reason: "github", retryable: true };
  }
  const baseRef = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const baseSha = baseRef.object.sha;
  let haveBranch = true;
  try {
    await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (error) {
    if (!(error instanceof GithubError) || error.status !== 404) throw error;
    haveBranch = false;
  }
  if (!haveBranch) {
    const content = `${JSON.stringify(reviewDocument(row), null, 2)}\n`;
    const blob = await gh(`/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "utf-8" }),
    });
    const parent = await gh(`/repos/${repo}/git/commits/${baseSha}`);
    const tree = await gh(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: [{ path: `rec-inbox/${row.id}.json`, mode: "100644", type: "blob", sha: blob.sha }],
      }),
    });
    const commit = await gh(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `REC inbox ${row.id}\n\nReview copy only. Not approved and not on air.`,
        tree: tree.sha,
        parents: [baseSha],
      }),
    });
    try {
      await gh(`/repos/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    } catch (error) {
      if (!(error instanceof GithubError) || error.status !== 422) throw error;
    }
  }

  const head = `${REC_OWNER}:${branch}`;
  const open = await listOpen(gh, head);
  if (open) return { prOpened: true, prUrl: open, reused: true };
  try {
    const pr = await gh(`/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: reviewTitle(video, row.id),
        head: branch,
        base,
        body: reviewBody(row, video),
      }),
    });
    if (!isOwnPull(pr?.html_url)) return { prOpened: false, reason: "github", retryable: true };
    return { prOpened: true, prUrl: pr.html_url, reused: false };
  } catch (error) {
    if (!(error instanceof GithubError) || error.status !== 422) throw error;
    const raced = await listOpen(gh, head);
    if (raced) return { prOpened: true, prUrl: raced, reused: true };
    throw error;
  }
}

function reviewTitle(video, id) {
  if (video) return `REC inbox: ${video.source} ${video.id}`;
  return `REC inbox: ${id.slice(0, 8)}`;
}

function reviewBody(row, video) {
  const url = String(row.url).replace(/```/g, "'''");
  return [
    "## REC inbox",
    "",
    "A viewer saved this link. This pull request is the review copy.",
    "It does not add a tape to the shelf, it is not approved, and it is not on air.",
    "",
    `plebflix-submission:${row.id}`,
    ...(video ? [`plebflix-video:${video.id}`] : []),
    "",
    "URL:",
    "```",
    url,
    "```",
    "",
    `Channel: ${row.channel}`,
    `Saved: ${row.created_at}`,
    "",
    "A person has to watch the video and check CLASSIC.md before any edit to channels/.",
    "",
  ].join("\n");
}

async function searchOpen(gh, marker) {
  try {
    const data = await gh(`/search/issues?q=${encodeURIComponent(`repo:${REC_REPO} is:pr is:open "${marker}"`)}&per_page=5`);
    const hit = (data?.items || []).find((item) => isOwnPull(item?.html_url));
    return hit ? hit.html_url : null;
  } catch (error) {
    if (error instanceof GithubError && (error.status === 403 || error.status === 422)) return null;
    throw error;
  }
}

async function listOpen(gh, head) {
  const rows = await gh(`/repos/${REC_REPO}/pulls?head=${encodeURIComponent(head)}&state=open`);
  const hit = (Array.isArray(rows) ? rows : []).find((item) => isOwnPull(item?.html_url));
  return hit ? hit.html_url : null;
}

function github(token, fetchImpl) {
  return async (path, init = {}) => {
    const url = `https://api.github.com${path}`;
    let response;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      response = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "plebflix-tv",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (attempt < 2 && (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504)) {
        await response.body?.cancel?.();
        continue;
      }
      break;
    }
    if (init.method === "DELETE" && (response.status === 204 || response.status === 404)) return null;
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { message: "unreadable" };
      }
    }
    if (!response.ok) throw new GithubError(response.status, "github");
    return payload;
  };
}

class GithubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "GithubError";
  }
}

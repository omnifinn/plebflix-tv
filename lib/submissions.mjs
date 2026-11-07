// REC saves the link in D1 first, then opens a GitHub review pull request.
// The shelf is not edited here. A missing token or a GitHub failure leaves the row
// and says so: the deck must not claim a pull request it did not open.
import { classicCutoff } from "./schema.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { edgeAllow } from "./votes.mjs";
import { ipKey } from "./ip.mjs";
import { ensureReviewPullRequest, recStatusMessage, sameTape, videoRef } from "./rec-pr.mjs";

const CHANNELS = ["suomi", "international"];
const HOURLY_LIMIT = 8;
const limiter = createRateLimiter({ limit: HOURLY_LIMIT, prefix: "rec" });

export function resetSubmissionLimiterForTests() {
  limiter.reset();
}

export function parseSubmission(body) {
  // The card is a link. The deck sends the TV that is on as the channel; anything else lands on International
  // and the librarian moves it if the tape is Finnish.
  const channel = CHANNELS.includes(body.channel) ? body.channel : "international";
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (/[\u0000-\u001f]/.test(raw)) return { ok: false, error: "Paste a full video link (https://…)." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Paste a full video link (https://…)." };
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || raw.length > 500) {
    return { ok: false, error: "Paste a full video link (https://…)." };
  }
  const cutoff = classicCutoff();
  let year = null;
  if (body.year !== undefined && body.year !== null && body.year !== "") {
    year = Number(body.year);
    if (!Number.isInteger(year) || year < 1970 || year > cutoff) return { ok: false, error: `A classic has to be from ${cutoff} or earlier.` };
  }
  const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : "");
  const signals = Array.isArray(body.signals)
    ? [...new Set(body.signals.filter((s) => typeof s === "string" && /^[a-e]$/.test(s)))].sort()
    : [];
  return {
    ok: true,
    submission: {
      url: url.toString(),
      channel,
      year,
      title: text(body.title, 160),
      why: text(body.why, 200),
      note: text(body.note, 500),
      submitter: text(body.submitter, 60),
      signals: signals.join(","),
    },
  };
}

export async function handleSubmit(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "The REC button only accepts POST." }, 405);
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: "That request came from outside the living room." }, 403);
    } catch {
      return json({ ok: false, error: "That request came from outside the living room." }, 403);
    }
  }
  const text = await request.text();
  if (text.length > 8000) return json({ ok: false, error: "That note is too long for the tape label." }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "The deck couldn't read that card." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "The deck couldn't read that card." }, 400);
  if (body.company) return json({ ok: true, message: "Got it." });

  const parsed = parseSubmission(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  if (!env.DB) return json({ ok: false, error: "The tape shelf is offline. Try again in a bit." }, 503);

  const ipHash = await ipKey(request, env);
  const gate = await limiter.allow(ipHash, env.RATE_LIMIT);
  if (!gate.ok) return json({ ok: false, error: "The deck is warm. Try another tape in a little while." }, 429, { "retry-after": "3600" });
  if (!(await edgeAllow(env.REC_RL, ipHash))) {
    return json({ ok: false, error: "The deck is warm. Try another tape in a little while." }, 429, { "retry-after": "60" });
  }
  const s = parsed.submission;
  const video = videoRef(s.url);
  let created = false;
  let row;
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first();
    if (Number(recent?.n || 0) >= HOURLY_LIMIT) {
      return json({ ok: false, error: "The deck is warm. Try another tape in a little while." }, 429, { "retry-after": "3600" });
    }
    const found = await env.DB.prepare(
      "SELECT id, url, title, channel, year, note, why, signals, submitter, created_at, status, pr_url FROM submissions WHERE url = ? OR (? != '' AND instr(url, ?) > 0) ORDER BY created_at LIMIT 20",
    )
      .bind(s.url, video?.id || "", video?.id || "")
      .all();
    const matches = (found?.results || []).filter((item) => sameTape(item.url, s.url));
    row = matches.find((item) => item.url === s.url) || matches[0] || null;
    if (!row) {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO submissions (id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      )
        .bind(id, s.url, s.title || null, s.channel, s.year, s.note || null, s.why || null, s.signals || null, s.submitter || null, ipHash, createdAt)
        .run();
      row = { id, url: s.url, title: s.title, channel: s.channel, year: s.year, note: s.note, why: s.why, signals: s.signals, submitter: s.submitter, created_at: createdAt, status: "pending", pr_url: null };
      created = true;
      console.log(JSON.stringify({ event: "submission", id, channel: s.channel }));
    }
  } catch {
    // The shelf (D1) did not answer. Say so in the deck's words instead of a bare 500.
    console.error(JSON.stringify({ event: "submission_failed", channel: s.channel }));
    return json({ ok: false, error: "The tape shelf didn't answer. Try again in a bit." }, 502);
  }

  if (row.pr_url && /^https:\/\/github\.com\/omnifinn\/plebflix-tv\/pull\/\d+$/.test(row.pr_url)) {
    return filed(row, { prUrl: row.pr_url, prOpened: true, reused: true }, { created, duplicate: !created });
  }
  // The row is the record. A decision already made does not open another review pull request.
  if (row.status === "rejected" || row.status === "accepted") {
    return filed(row, { reason: "decided" }, { created, duplicate: !created });
  }

  let result;
  try {
    result = await ensureReviewPullRequest(env, row, env.fetchImpl || globalThis.fetch);
  } catch (error) {
    console.error(JSON.stringify({ event: "rec_pr_failed", id: row.id, status: error?.status || 0 }));
    result = { prOpened: false, reason: "github", retryable: true };
  }
  if (result.prUrl) {
    try {
      await env.DB.prepare("UPDATE submissions SET pr_url = ? WHERE id = ? AND (pr_url IS NULL OR pr_url = '')").bind(result.prUrl, row.id).run();
      row.pr_url = result.prUrl;
    } catch {
      console.error(JSON.stringify({ event: "rec_pr_unrecorded", id: row.id }));
    }
  }
  return filed(row, result, { created, duplicate: !created });
}

function filed(row, result, { created, duplicate }) {
  const prUrl = result.prUrl && /^https:\/\/github\.com\/omnifinn\/plebflix-tv\/pull\/\d+$/.test(result.prUrl) ? result.prUrl : null;
  return json(
    {
      ok: true,
      saved: true,
      id: row.id,
      duplicate: duplicate || undefined,
      prOpened: Boolean(prUrl),
      prUrl,
      retryable: result.reason === "decided" ? false : !prUrl,
      message: recStatusMessage({ ...result, prUrl }, { duplicate }),
    },
    created ? 201 : 200,
  );
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
}

// REC → D1 `submissions`. No GitHub token on the Worker: the daily librarian routine
// reads pending rows through the Cloudflare API, vets them and opens the pull requests.
import { classicCutoff } from "./schema.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { edgeAllow } from "./votes.mjs";
import { ipKey } from "./ip.mjs";

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
  if (body.company) return json({ ok: true, message: "Tape received — it'll be reviewed and opened as a pull request on GitHub." });

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
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first();
    if (Number(recent?.n || 0) >= HOURLY_LIMIT) {
      return json({ ok: false, error: "The deck is warm. Try another tape in a little while." }, 429, { "retry-after": "3600" });
    }
    const dupe = await env.DB.prepare("SELECT id, status FROM submissions WHERE url = ? LIMIT 1").bind(s.url).first();
    if (dupe) return json({ ok: true, id: dupe.id, duplicate: true, message: "Someone already recorded that tape — it's on the review pile." });
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO submissions (id, url, title, channel, year, note, why, signals, submitter, ip_hash, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    )
      .bind(id, s.url, s.title || null, s.channel, s.year, s.note || null, s.why || null, s.signals || null, s.submitter || null, ipHash, new Date().toISOString())
      .run();
    console.log(JSON.stringify({ event: "submission", id, channel: s.channel }));
    return json({ ok: true, id, message: "Tape received — it'll be reviewed and opened as a pull request on GitHub." }, 201);
  } catch {
    // The shelf (D1) did not answer. Say so in the deck's words instead of a bare 500.
    console.error(JSON.stringify({ event: "submission_failed", channel: s.channel }));
    return json({ ok: false, error: "The tape shelf didn't answer. Try again in a bit." }, 502);
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
}

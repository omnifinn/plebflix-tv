import { createRateLimiter } from "./rate-limit.mjs";
import { dayKey, wilsonLower } from "../public/schedule.js";
import suomi from "../channels/suomi.json" with { type: "json" };
import international from "../channels/international.json" with { type: "json" };

const CHANNELS = {
  suomi,
  international,
};

const voteLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000, prefix: "vote" });
const playLimiter = createRateLimiter({ limit: 600, windowMs: 60 * 60 * 1000, prefix: "play" });

const VIEWER_RE = /^[A-Za-z0-9-]{8,80}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MISSING_SHELF =
  "The tape deck has no vote shelf. Create the D1 database plebflix-tv, bind it as DB, and apply migrations.";

export function resetVoteLimitersForTests() {
  voteLimiter.reset();
  playLimiter.reset();
}

/**
 * In-memory shelf with the same rules as D1. Tests use this.
 * A duplicate vote returns false. A repeat impression on the same UTC day returns false.
 */
export function memoryStore() {
  /** @type {Array<{ viewerId: string, itemId: string, channel: string, vote: number, createdAt: string }>} */
  const votes = [];
  /** @type {Array<{ viewerId: string, itemId: string, channel: string, day: string, createdAt: string }>} */
  const impressions = [];
  return {
    async addVote(row) {
      if (votes.some((vote) => vote.viewerId === row.viewerId && vote.itemId === row.itemId)) return false;
      votes.push(row);
      return true;
    },
    async addImpression(row) {
      const again = impressions.some(
        (hit) => hit.viewerId === row.viewerId && hit.itemId === row.itemId && hit.day === row.day,
      );
      if (again) return false;
      impressions.push(row);
      return true;
    },
    async stats(channel, before) {
      /** @type {Record<string, { up: number, down: number, impressions: number }>} */
      const map = {};
      const rowFor = (itemId) => {
        if (!map[itemId]) map[itemId] = { up: 0, down: 0, impressions: 0 };
        return map[itemId];
      };
      for (const vote of votes) {
        if (vote.channel !== channel || vote.createdAt >= before) continue;
        const row = rowFor(vote.itemId);
        if (vote.vote === 1) row.up += 1;
        else row.down += 1;
      }
      for (const hit of impressions) {
        if (hit.channel !== channel || hit.createdAt >= before) continue;
        rowFor(hit.itemId).impressions += 1;
      }
      return map;
    },
  };
}

/** @param {D1Database} db */
export function d1Store(db) {
  return {
    async addVote(row) {
      const existing = await db
        .prepare("SELECT vote FROM votes WHERE viewer_id = ?1 AND item_id = ?2")
        .bind(row.viewerId, row.itemId)
        .first();
      if (existing) return false;
      await db
        .prepare(
          "INSERT INTO votes (viewer_id, item_id, channel, vote, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(row.viewerId, row.itemId, row.channel, row.vote, row.createdAt)
        .run();
      return true;
    },
    async addImpression(row) {
      const result = await db
        .prepare(
          "INSERT OR IGNORE INTO impressions (viewer_id, item_id, channel, day, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(row.viewerId, row.itemId, row.channel, row.day, row.createdAt)
        .run();
      return (result?.meta?.changes || 0) > 0;
    },
    async stats(channel, before) {
      const votes = await db
        .prepare(
          `SELECT item_id AS itemId,
                  SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up,
                  SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
             FROM votes
            WHERE channel = ?1 AND created_at < ?2
            GROUP BY item_id`,
        )
        .bind(channel, before)
        .all();
      const plays = await db
        .prepare(
          `SELECT item_id AS itemId, COUNT(*) AS impressions
             FROM impressions
            WHERE channel = ?1 AND created_at < ?2
            GROUP BY item_id`,
        )
        .bind(channel, before)
        .all();
      /** @type {Record<string, { up: number, down: number, impressions: number }>} */
      const map = {};
      for (const row of votes.results || []) {
        map[String(row.itemId)] = {
          up: Number(row.up) || 0,
          down: Number(row.down) || 0,
          impressions: 0,
        };
      }
      for (const row of plays.results || []) {
        const id = String(row.itemId);
        if (!map[id]) map[id] = { up: 0, down: 0, impressions: 0 };
        map[id].impressions = Number(row.impressions) || 0;
      }
      return map;
    },
  };
}

/**
 * @param {Request} request
 * @param {{ DB?: D1Database, VOTE_STORE?: ReturnType<typeof memoryStore>, RATE_LIMIT?: { get: Function, put: Function } }} env
 */
export async function handleVote(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "The vote buttons only accept POST." }, 405);
  const store = storeFrom(env);
  if (!store) return json({ ok: false, error: MISSING_SHELF }, 503);
  const read = await readJson(request);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const origin = checkOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  const ip = clientIp(request);
  const gate = await voteLimiter.allow(ip, env.RATE_LIMIT);
  if (!gate.ok) {
    return json({ ok: false, error: "The remote is warm. Wait a bit before another vote." }, 429, {
      "retry-after": String(gate.retryAfter || 3600),
    });
  }
  const parsed = parseVote(read.body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const known = knownItem(parsed.channel, parsed.itemId);
  if (!known) return json({ ok: false, error: "That tape is not on this channel." }, 404);
  try {
    const fresh = await store.addVote({
      viewerId: parsed.viewerId,
      itemId: parsed.itemId,
      channel: parsed.channel,
      vote: parsed.vote,
      createdAt: new Date().toISOString(),
    });
    if (!fresh) return json({ ok: false, error: "ALREADY VOTED" }, 409);
    return json({ ok: true, itemId: parsed.itemId, vote: parsed.direction });
  } catch (error) {
    const text = String(error instanceof Error ? error.message : error);
    if (/UNIQUE/i.test(text)) return json({ ok: false, error: "ALREADY VOTED" }, 409);
    console.error(JSON.stringify({ event: "vote_failed", channel: parsed.channel, itemId: parsed.itemId }));
    return json({ ok: false, error: "The vote didn't stick." }, 502);
  }
}

/**
 * @param {Request} request
 * @param {{ DB?: D1Database, VOTE_STORE?: ReturnType<typeof memoryStore>, RATE_LIMIT?: { get: Function, put: Function } }} env
 */
export async function handleImpression(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Play counts only accept POST." }, 405);
  const store = storeFrom(env);
  if (!store) return json({ ok: false, error: MISSING_SHELF }, 503);
  const read = await readJson(request);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const origin = checkOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  const gate = await playLimiter.allow(clientIp(request), env.RATE_LIMIT);
  if (!gate.ok) {
    return json({ ok: false, error: "The play counter is warm." }, 429, {
      "retry-after": String(gate.retryAfter || 3600),
    });
  }
  const parsed = parsePlay(read.body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  if (!knownItem(parsed.channel, parsed.itemId)) {
    return json({ ok: false, error: "That tape is not on this channel." }, 404);
  }
  const now = new Date();
  try {
    await store.addImpression({
      viewerId: parsed.viewerId,
      itemId: parsed.itemId,
      channel: parsed.channel,
      day: dayKey(now.getTime()),
      createdAt: now.toISOString(),
    });
    return json({ ok: true });
  } catch {
    console.error(JSON.stringify({ event: "impression_failed", channel: parsed.channel, itemId: parsed.itemId }));
    return json({ ok: false, error: "The play count didn't stick." }, 502);
  }
}

/**
 * @param {Request} request
 * @param {{ DB?: D1Database, VOTE_STORE?: ReturnType<typeof memoryStore> }} env
 */
export async function handleStats(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Stats only accept GET." }, 405);
  const store = storeFrom(env);
  if (!store) return json({ ok: false, error: MISSING_SHELF }, 503);
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") || "";
  if (!CHANNELS[channel]) return json({ ok: false, error: "Pick Suomi or International." }, 400);
  const day = url.searchParams.get("day") || dayKey(Date.now());
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) {
    return json({ ok: false, error: "The day has to be YYYY-MM-DD." }, 400);
  }
  const before = `${day}T00:00:00.000Z`;
  try {
    const raw = await store.stats(channel, before);
    /** @type {Record<string, { up: number, down: number, net: number, wilson: number, impressions: number }>} */
    const items = {};
    for (const [itemId, row] of Object.entries(raw)) {
      const up = Number(row.up) || 0;
      const down = Number(row.down) || 0;
      items[itemId] = {
        up,
        down,
        net: up - down,
        wilson: wilsonLower(up, down),
        impressions: Number(row.impressions) || 0,
      };
    }
    return json({ ok: true, channel, day, items });
  } catch {
    console.error(JSON.stringify({ event: "stats_failed", channel }));
    return json({ ok: false, error: "The vote shelf didn't answer." }, 502);
  }
}

/** @param {{ DB?: D1Database, VOTE_STORE?: ReturnType<typeof memoryStore> }} env */
function storeFrom(env) {
  if (env.VOTE_STORE) return env.VOTE_STORE;
  if (env.DB) return d1Store(env.DB);
  return null;
}

/**
 * A tape can take a vote when it is on the shelf and not still pending.
 * @param {string} channel
 * @param {string} itemId
 */
export function knownItem(channel, itemId) {
  const doc = CHANNELS[channel];
  if (!doc) return null;
  return (
    doc.items.find((item) => item.id === itemId && item.status !== "pending" && item.duration > 0) || null
  );
}

/** @param {Record<string, unknown>} body */
function parseVote(body) {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const direction = body.vote;
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: "Vote up or down." };
  }
  return { ok: true, ...common, direction, vote: direction === "up" ? 1 : -1 };
}

/** @param {Record<string, unknown>} body */
function parsePlay(body) {
  return parseCommon(body);
}

/** @param {Record<string, unknown>} body */
function parseCommon(body) {
  if (Object.keys(body).length > 6) return { ok: false, error: "The deck couldn't read that card." };
  const channel = body.channel;
  if (channel !== "suomi" && channel !== "international") {
    return { ok: false, error: "Pick Suomi or International." };
  }
  if (typeof body.itemId !== "string" || !SLUG_RE.test(body.itemId) || body.itemId.length > 80) {
    return { ok: false, error: "That tape id is not on the label." };
  }
  if (typeof body.viewerId !== "string" || !VIEWER_RE.test(body.viewerId)) {
    return { ok: false, error: "The viewer id is missing." };
  }
  return { ok: true, channel, itemId: body.itemId, viewerId: body.viewerId };
}

/** @param {Request} request */
async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > 2000) {
    return { ok: false, status: 413, error: "That note is too long for the tape label." };
  }
  const text = await request.text();
  if (text.length > 2000) return { ok: false, status: 413, error: "That note is too long for the tape label." };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, status: 400, error: "The deck couldn't read that card." };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, status: 400, error: "The deck couldn't read that card." };
  }
}

/** @param {Request} request */
function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return { ok: true };
  try {
    if (new URL(origin).host !== new URL(request.url).host) {
      return { ok: false, error: "That request came from outside the living room." };
    }
  } catch {
    return { ok: false, error: "That request came from outside the living room." };
  }
  return { ok: true };
}

/** @param {Request} request */
function clientIp(request) {
  return (request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "local")
    .split(",")[0]
    .trim() || "local";
}

/** @param {unknown} data @param {number} [status] @param {Record<string, string>} [extra] */
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

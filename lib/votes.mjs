import { createRateLimiter } from "./rate-limit.mjs";
import { clientIp, ipKey, normalizeIp } from "./ip.mjs";
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
/** Votes one address (IPv6: one /64) may cast on one tape, whatever viewer ids it invents. */
export const IP_ITEM_CAP = 5;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Stats can be asked for the last week and for tomorrow: every other day is a cache miss and a table scan. */
const STATS_DAYS_BACK = 7;

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
      if (row.ipHash && votes.filter((vote) => vote.itemId === row.itemId && vote.ipHash === row.ipHash).length >= IP_ITEM_CAP) return false;
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
    async addImpressions(rows) {
      const stmt = db.prepare("INSERT OR IGNORE INTO impressions (viewer_id, item_id, channel, day, created_at) VALUES (?1, ?2, ?3, ?4, ?5)");
      await db.batch(rows.map((r) => stmt.bind(r.viewerId, r.itemId, r.channel, r.day, r.createdAt)));
    },
    async addVote(row) {
      const existing = await db
        .prepare("SELECT vote FROM votes WHERE viewer_id = ?1 AND item_id = ?2")
        .bind(row.viewerId, row.itemId)
        .first();
      if (existing) return false;
      if (row.ipHash) {
        const cast = await db
          .prepare("SELECT COUNT(*) AS n FROM votes WHERE item_id = ?1 AND ip_hash = ?2")
          .bind(row.itemId, row.ipHash)
          .first();
        if (Number(cast?.n || 0) >= IP_ITEM_CAP) return false;
      }
      await db
        .prepare(
          "INSERT INTO votes (viewer_id, item_id, channel, vote, created_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(row.viewerId, row.itemId, row.channel, row.vote, row.createdAt, row.ipHash || null)
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
  const ip = normalizeIp(clientIp(request));
  const gate = await voteLimiter.allow(ip, env.RATE_LIMIT);
  if (!gate.ok) {
    return json({ ok: false, error: "The remote is warm. Wait a bit before another vote." }, 429, {
      "retry-after": String(gate.retryAfter || 3600),
    });
  }
  if (!(await edgeAllow(env.VOTE_RL, ip))) {
    return json({ ok: false, error: "The remote is warm. Wait a bit before another vote." }, 429, { "retry-after": "60" });
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
      ipHash: await ipKey(request, env),
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
  const ip = normalizeIp(clientIp(request));
  const gate = await playLimiter.allow(ip, env.RATE_LIMIT);
  if (!gate.ok) {
    return json({ ok: false, error: "The play counter is warm." }, 429, {
      "retry-after": String(gate.retryAfter || 60),
    });
  }
  // The player batches plays: { viewerId, plays: [{ itemId, channel }, …] } (up to 20). A single play still works.
  const body = read.body;
  const list = Array.isArray(body.plays) ? body.plays.slice(0, 20).map((p) => ({ ...(p && typeof p === "object" ? p : {}), viewerId: body.viewerId })) : [body];
  if (!list.length) return json({ ok: false, error: "No plays on that card." }, 400);
  const rows = [];
  const now = new Date();
  for (const one of list) {
    const parsed = parsePlay(one);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    if (!knownItem(parsed.channel, parsed.itemId)) continue;
    rows.push({ viewerId: parsed.viewerId, itemId: parsed.itemId, channel: parsed.channel, day: dayKey(now.getTime()), createdAt: now.toISOString() });
  }
  if (!rows.length) return json({ ok: false, error: "That tape is not on this channel." }, 404);
  // The edge limit is spent per row, so a batch of twenty costs twenty: one address cannot write faster
  // than PLAY_RL allows however it packs the request.
  for (let i = 0; i < rows.length; i += 1) {
    if (!(await edgeAllow(env.PLAY_RL, ip))) return json({ ok: false, error: "The play counter is warm." }, 429, { "retry-after": "60" });
  }
  try {
    if (store.addImpressions) await store.addImpressions(rows);
    else for (const row of rows) await store.addImpression(row);
    return json({ ok: true, counted: rows.length });
  } catch {
    console.error(JSON.stringify({ event: "impression_failed", count: rows.length }));
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
  if (!Object.hasOwn(CHANNELS, channel)) return json({ ok: false, error: "Pick Suomi or International." }, 400);
  const day = url.searchParams.get("day") || dayKey(Date.now());
  const dayMs = DAY_RE.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  const todayMs = Date.parse(`${dayKey(Date.now())}T00:00:00.000Z`);
  if (
    Number.isNaN(dayMs) ||
    new Date(dayMs).toISOString().slice(0, 10) !== day ||
    dayMs > todayMs + 86400000 ||
    dayMs < todayMs - STATS_DAYS_BACK * 86400000
  ) {
    return json({ ok: false, error: "The day has to be YYYY-MM-DD, within the last week or tomorrow." }, 400);
  }
  const before = `${day}T00:00:00.000Z`;
  // Stats scan the vote/play tables, so they are cached at the edge: a day whose midnight has passed is
  // frozen (new rows are always later) and is kept until it rolls off; tomorrow's ranking refreshes every 10 min.
  const frozen = Date.parse(before) <= Date.now();
  const ttl = frozen ? 86400 : 600;
  const cache = env.STATS_CACHE === null ? null : env.STATS_CACHE || globalThis.caches?.default;
  // A frozen day and the same day while it was still tomorrow are different snapshots: separate keys.
  const key = new Request(`https://stats.plebflix.internal/${channel}/${day}/${frozen ? "frozen" : "live"}`);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${frozen ? 3600 : 300}`, "x-content-type-options": "nosniff", "x-stats-cache": "hit" } });
    } catch {
      /* fall through to D1 */
    }
  }
  // A miss scans the vote and play tables, so it is paid for like a play count.
  if (!(await edgeAllow(env.PLAY_RL, normalizeIp(clientIp(request))))) {
    return json({ ok: false, error: "The stats shelf is warm." }, 429, { "retry-after": "60" });
  }
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
    const payload = JSON.stringify({ ok: true, channel, day, items });
    if (cache) {
      try {
        await cache.put(key, new Response(payload, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` } }));
      } catch {
        /* uncached is fine */
      }
    }
    return new Response(payload, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${frozen ? 3600 : 300}`, "x-content-type-options": "nosniff", "x-stats-cache": "miss" } });
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

/**
 * Cloudflare's Rate Limiting binding (free, counted at the edge per location) when it is bound;
 * the in-memory limiter above still applies per isolate either way.
 * @param {{ limit: Function } | undefined} binding @param {string} key
 */
export async function edgeAllow(binding, key) {
  if (!binding || typeof binding.limit !== "function") return true;
  try {
    const { success } = await binding.limit({ key });
    return success !== false;
  } catch {
    return true;
  }
}

/** @param {unknown} data @param {number} [status] @param {Record<string, string>} [extra] */
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

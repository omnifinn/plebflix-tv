/** Playable tapes only. Pending suggestions stay on the shelf. */
export function liveItems(channel) {
  return (channel.items || []).filter((item) => item.status !== "pending" && item.duration > 0);
}

export function totalDuration(items) {
  return items.reduce((sum, item) => sum + item.duration, 0);
}

/** Integer seconds since the Unix epoch, wrapped onto the playlist. */
export function liveSeconds(items, epochMs) {
  const total = totalDuration(items);
  if (!total) return 0;
  const sec = Math.floor(epochMs / 1000);
  return ((sec % total) + total) % total;
}

/**
 * @param {Array<{ duration: number }>} items
 * @param {number} seconds position inside the looping playlist
 */
export function spotAt(items, seconds) {
  const total = totalDuration(items);
  if (!items.length || total <= 0) return null;
  const mod = ((seconds % total) + total) % total;
  let start = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (mod < start + item.duration) {
      return { item, index, offset: mod - start, start, total };
    }
    start += item.duration;
  }
  const last = items[items.length - 1];
  return {
    item: last,
    index: items.length - 1,
    offset: 0,
    start: total - last.duration,
    total,
  };
}

export const DAY_SECONDS = 24 * 60 * 60;
export const NO_REPEAT_SECONDS = 6 * 60 * 60;
export const IDENT_SECONDS = 8;

/** UTC day, so every viewer builds the same block. */
export function dayKey(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lower bound of a Wilson score for thumbs-up against thumbs-down. */
export function wilsonLower(up, down, z = 1.96) {
  const positive = Number(up) || 0;
  const negative = Number(down) || 0;
  const n = positive + negative;
  if (n <= 0) return 0.5;
  const phat = positive / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

/**
 * How often a clip should be drawn. Thin votes stay near 1, with a small
 * boost for tapes almost nobody has been shown and for pre-YouTube years.
 * A poor Wilson score sinks the weight but does not ban the tape.
 */
export function airWeight(item, stats) {
  const year = Number(item?.year) || 2010;
  const up = Number(stats?.up) || 0;
  const down = Number(stats?.down) || 0;
  const impressions = Number(stats?.impressions) || 0;
  const votes = up + down;
  let era = 0;
  if (year < 2005) era = 0.15;
  else if (year < 2010) era = 0.05;
  if (votes < 8) return (impressions < 2 ? 1.15 : 1) + era;
  return 0.25 + wilsonLower(up, down) * 1.9 + era;
}

export const TAGLINE = "Plebflix — real human slop";

export function identFor(channel, variant) {
  const number = String(channel.number || 1).padStart(2, "0");
  const cards = [
    { title: channel.name, line: TAGLINE },
    { title: `CH ${number}`, line: TAGLINE },
    { title: "PLEBFLIX", line: TAGLINE },
  ];
  const card = cards[Math.abs(variant) % cards.length];
  return {
    kind: "ident",
    id: `ident-${channel.id}-${Math.abs(variant) % cards.length}`,
    title: card.title,
    line: card.line,
    duration: IDENT_SECONDS,
    source: "ident",
  };
}

/**
 * One UTC day's broadcast. Same catalog, day, and vote snapshot always
 * produce the same order. Clips are drawn with weights and then held out
 * for six hours. A station ident sits between clips.
 */
export function buildBroadcast(channel, epochMs, statsById = {}) {
  const items = liveItems(channel);
  const rand = mulberry32(hashSeed(`${channel.id}:${dayKey(epochMs)}`));
  const out = [];
  const lastAired = new Map();
  let cursor = 0;
  let guard = 0;
  while (cursor < DAY_SECONDS && items.length && guard < 8000) {
    guard += 1;
    const clip = pickClip(items, lastAired, cursor, statsById, rand);
    if (!clip) break;
    out.push(clip);
    cursor += clip.duration;
    lastAired.set(clip.id, cursor);
    const ident = identFor(channel, Math.floor(rand() * 3));
    out.push(ident);
    cursor += ident.duration;
  }
  return out;
}

function pickClip(items, lastAired, cursor, statsById, rand) {
  const fresh = items.filter((item) => {
    const previous = lastAired.get(item.id);
    return previous === undefined || cursor - previous >= NO_REPEAT_SECONDS;
  });
  let pool = fresh;
  if (!pool.length) {
    pool = items
      .slice()
      .sort((a, b) => (lastAired.get(a.id) ?? -1) - (lastAired.get(b.id) ?? -1))
      .slice(0, Math.max(1, Math.ceil(items.length / 4)));
  }
  return weightedPick(pool, statsById, rand);
}

function weightedPick(pool, statsById, rand) {
  const weights = pool.map((item) => airWeight(item, statsById[item.id]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = rand() * total;
  for (let index = 0; index < pool.length; index += 1) {
    ticket -= weights[index];
    if (ticket <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}

/** Signed seconds ahead (positive) or behind live, wrapped to the short way around. */
export function shiftFromLive(playPos, livePos, total) {
  if (!total) return 0;
  let delta = playPos - livePos;
  if (delta > total / 2) delta -= total;
  if (delta < -total / 2) delta += total;
  return delta;
}

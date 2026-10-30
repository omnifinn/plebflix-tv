/** Playable tapes only. Pending suggestions stay on the shelf; a tape added today airs from tomorrow (UTC). */
export function liveItems(channel, epochMs = Date.now()) {
  const today = dayKey(epochMs);
  return (channel.items || []).filter(
    (item) => item.status !== "pending" && item.duration > 0 && (typeof item.added !== "string" || item.added < today),
  );
}

export function totalDuration(items) {
  return items.reduce((sum, item) => sum + item.duration, 0);
}

/** Epoch seconds at which this UTC day began. */
export function dayStartSeconds(epochMs) {
  const at = new Date(epochMs);
  return Math.floor(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / 1000);
}

/**
 * Whole seconds since this UTC day began, wrapped onto the playlist. The day's lineup covers at least a
 * day (buildBroadcast), so it starts at 00:00 UTC and the only cut in the broadcast is midnight.
 */
export function liveSeconds(items, epochMs) {
  const total = totalDuration(items);
  if (!total) return 0;
  const sec = Math.floor(epochMs / 1000) - dayStartSeconds(epochMs);
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

export function identFor(channel, variant, seconds = IDENT_SECONDS) {
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
    duration: seconds,
    source: "ident",
  };
}

/* ── Schedule definitions (channels/schedule.json) ───────────────────────────────────────────────────────────── */

/** What a channel airs like when channels/schedule.json says nothing about it. */
export const DEFAULT_DEFINITION = Object.freeze({
  order: "seeded",
  hold_out_hours: NO_REPEAT_SECONDS / 3600,
  ident_seconds: IDENT_SECONDS,
  slots: Object.freeze([]),
});

/** "HH:MM" (UTC) → seconds since midnight, or NaN. */
export function slotSeconds(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || ""));
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

/**
 * The definition for one channel id: `defaults` from the file, then the channel's own block (`channels[id]`) or,
 * for a category channel (`<lang>-<cat>`), the block for its language's TV (`channels[lang]`) when it has none itself.
 * Unknown keys are ignored; malformed values fall back to the default so a bad edit cannot blank a channel.
 */
export function resolveDefinition(doc, channelId) {
  const file = doc && typeof doc === "object" ? doc : {};
  const blocks = file.channels && typeof file.channels === "object" ? file.channels : {};
  const lang = String(channelId || "").split("-")[0];
  const own = blocks[channelId] && typeof blocks[channelId] === "object" ? blocks[channelId] : null;
  const layers = [DEFAULT_DEFINITION, file.defaults, own || blocks[lang]].filter((layer) => layer && typeof layer === "object");
  const out = { ...DEFAULT_DEFINITION, slots: [] };
  for (const layer of layers) {
    if (layer.order === "seeded" || layer.order === "catalog") out.order = layer.order;
    if (Number.isFinite(layer.hold_out_hours) && layer.hold_out_hours >= 0 && layer.hold_out_hours <= 24) out.hold_out_hours = layer.hold_out_hours;
    if (Number.isInteger(layer.ident_seconds) && layer.ident_seconds >= 1 && layer.ident_seconds <= 60) out.ident_seconds = layer.ident_seconds;
    if (Array.isArray(layer.slots)) {
      out.slots = layer.slots
        .filter((slot) => slot && typeof slot === "object" && typeof slot.tape === "string" && Number.isFinite(slotSeconds(slot.at)))
        .map((slot) => ({ at: slotSeconds(slot.at), tape: slot.tape }))
        .sort((a, b) => a.at - b.at);
    }
  }
  return out;
}

/**
 * One UTC day's broadcast. Same catalog, day, vote snapshot and definition always produce the same order, on
 * every device. `order: "seeded"` draws clips by weight and holds each out for `hold_out_hours`; `order: "catalog"`
 * plays the file order round and round. Fixed `slots` (UTC) are landed exactly: the gap before one is filled with
 * clips that fit, then a longer ident. A station ident sits between clips.
 */
export function buildBroadcast(channel, epochMs, statsById = {}, definition = DEFAULT_DEFINITION) {
  const def = definition === DEFAULT_DEFINITION ? definition : { ...DEFAULT_DEFINITION, ...definition };
  const items = liveItems(channel, epochMs);
  const byId = new Map(items.map((item) => [item.id, item]));
  const rand = mulberry32(hashSeed(`${channel.id}:${dayKey(epochMs)}`));
  const holdOut = Math.round((def.hold_out_hours ?? DEFAULT_DEFINITION.hold_out_hours) * 3600);
  const identSeconds = def.ident_seconds || IDENT_SECONDS;
  // Slots that name a tape on this channel, in time order, one per second of the day.
  const slots = (def.slots || []).filter((slot) => byId.has(slot.tape) && slot.at >= 0 && slot.at < DAY_SECONDS);
  const out = [];
  const lastAired = new Map();
  let cursor = 0;
  let guard = 0;
  let catalogAt = 0;
  let slotIndex = 0;
  const place = (clip) => {
    out.push(clip);
    cursor += clip.duration;
    lastAired.set(clip.id, cursor);
  };
  const ident = (seconds = identSeconds) => {
    out.push(identFor(channel, Math.floor(rand() * 3), seconds));
    cursor += seconds;
  };
  while (cursor < DAY_SECONDS && items.length && guard < 8000) {
    guard += 1;
    // Skip slots the fill has already passed (a tape longer than the gap can overrun the next slot).
    while (slotIndex < slots.length && slots[slotIndex].at < cursor) slotIndex += 1;
    const slot = slotIndex < slots.length ? slots[slotIndex] : null;
    if (slot && slot.at === cursor) {
      place(byId.get(slot.tape));
      slotIndex += 1;
      ident();
      continue;
    }
    const room = slot ? slot.at - cursor - identSeconds : Infinity;
    let clip;
    if (def.order === "catalog") {
      // File order, round and round; before a slot, the next clip that fits the gap.
      for (let step = 0; step < items.length; step += 1) {
        const candidate = items[(catalogAt + step) % items.length];
        if (candidate.duration <= room) {
          clip = candidate;
          catalogAt = (catalogAt + step + 1) % items.length;
          break;
        }
      }
    } else {
      clip = pickClip(items, lastAired, cursor, statsById, rand, holdOut, room);
    }
    if (!clip) {
      // Nothing fits before the slot: a longer ident carries the gap, then the slot lands exactly.
      ident(slot.at - cursor);
      continue;
    }
    place(clip);
    if (slot && cursor + identSeconds > slot.at) {
      // The clip leaves less than an ident before the slot: stretch the ident to meet it.
      ident(Math.max(1, slot.at - cursor));
      continue;
    }
    ident();
  }
  return out;
}

function pickClip(items, lastAired, cursor, statsById, rand, holdOut = NO_REPEAT_SECONDS, room = Infinity) {
  const fits = items.filter((item) => item.duration <= room);
  if (!fits.length) return null;
  const fresh = fits.filter((item) => {
    const previous = lastAired.get(item.id);
    return previous === undefined || cursor - previous >= holdOut;
  });
  let pool = fresh;
  if (!pool.length) {
    pool = fits
      .slice()
      .sort((a, b) => (lastAired.get(a.id) ?? -1) - (lastAired.get(b.id) ?? -1))
      .slice(0, Math.max(1, Math.ceil(fits.length / 4)));
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

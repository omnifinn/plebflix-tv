const SOURCES = new Set(["youtube", "archive.org", "vimeo", "other"]);
const SIGNALS = new Set(["a", "b", "c", "d", "e"]);
const LICENSES = new Set(["cc0", "cc-by", "cc-by-sa", "public-domain"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Viral peak in 2013 or earlier, so the release year can be 2013 at the latest (and at least ten years ago). */
export const PEAK_CUTOFF = 2013;
export function classicCutoff(now = new Date()) {
  return Math.min(PEAK_CUTOFF, now.getUTCFullYear() - 10);
}

/**
 * @param {unknown} item
 * @param {number} index
 * @param {Set<string>} ids
 * @param {Set<string>} embeds
 * @returns {string[]}
 */
export function validateItem(item, index, ids, embeds, plays = new Set()) {
  const where = `items[${index}]`;
  const errors = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [`${where} must be an object`];
  }
  const row = /** @type {Record<string, unknown>} */ (item);
  if (typeof row.id !== "string" || !ID_RE.test(row.id) || row.id.length > 80) {
    errors.push(`${where}.id must be a lowercase slug`);
  } else if (ids.has(row.id)) {
    errors.push(`${where}.id "${row.id}" is duplicated`);
  } else {
    ids.add(row.id);
  }

  if (typeof row.title !== "string" || row.title.trim().length < 1 || row.title.length > 160) {
    errors.push(`${where}.title must be 1–160 characters`);
  }
  const cutoff = classicCutoff();
  if (typeof row.year !== "number" || !Number.isInteger(row.year) || row.year < 1970 || row.year > 2100) {
    errors.push(`${where}.year must be an integer from 1970 to 2100`);
  } else if (row.year > cutoff) {
    errors.push(`${where}.year must be ${cutoff} or earlier`);
  }
  if (!Array.isArray(row.signals) || row.signals.length < 3 || row.signals.length > 5) {
    errors.push(`${where}.signals must list at least 3 of a, b, c, d, e`);
  } else {
    const seen = new Set();
    for (const signal of row.signals) {
      if (!SIGNALS.has(signal) || seen.has(signal)) {
        errors.push(`${where}.signals must be unique letters a–e`);
        break;
      }
      seen.add(signal);
    }
  }
  if (typeof row.why !== "string" || row.why.trim().length < 1 || row.why.length > 200 || /[\r\n]/.test(row.why)) {
    errors.push(`${where}.why must be one line of 1–200 characters`);
  }
  if (typeof row.original_url !== "string" || !isHttpUrl(row.original_url) || row.original_url.length > 500) {
    errors.push(`${where}.original_url must be an http(s) URL`);
  }
  if (typeof row.source !== "string" || !SOURCES.has(row.source)) {
    errors.push(`${where}.source must be youtube, archive.org, vimeo, or other`);
  }
  if (typeof row.embedId !== "string" || row.embedId.length < 1 || row.embedId.length > 500) {
    errors.push(`${where}.embedId is missing`);
  } else if (row.source === "youtube" && !/^[A-Za-z0-9_-]{6,32}$/.test(row.embedId)) {
    errors.push(`${where}.embedId is not a YouTube id`);
  } else if (row.source === "vimeo" && !/^\d{5,12}$/.test(row.embedId)) {
    errors.push(`${where}.embedId is not a Vimeo id`);
  } else if (
    row.source === "archive.org" &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(row.embedId)
  ) {
    errors.push(`${where}.embedId is not an archive.org identifier`);
  } else {
    const key = `${row.source}:${row.embedId}`;
    if (embeds.has(key)) errors.push(`${where}.embedId "${row.embedId}" is duplicated`);
    else embeds.add(key);
  }

  const pending = row.status === "pending";
  if (row.status !== undefined && row.status !== "pending" && row.status !== "live") {
    errors.push(`${where}.status must be "pending" or "live"`);
  }
  if (typeof row.duration !== "number" || !Number.isInteger(row.duration)) {
    errors.push(`${where}.duration must be an integer number of seconds`);
  } else if (pending) {
    if (row.duration < 0 || row.duration > 7200) {
      errors.push(`${where}.duration must be between 0 and 7200 while pending`);
    }
  } else if (row.duration < 1 || row.duration > 7200) {
    errors.push(`${where}.duration must be between 1 and 7200 seconds`);
  }

  if (typeof row.note !== "string" || row.note.length > 500) {
    errors.push(`${where}.note must be a string of at most 500 characters`);
  }
  if (row.credit !== undefined) {
    if (typeof row.credit !== "string" || !isHttpUrl(row.credit) || row.credit.length > 500) {
      errors.push(`${where}.credit must be an http(s) URL`);
    }
  }
  if (row.license !== undefined && !LICENSES.has(row.license)) {
    errors.push(`${where}.license must be cc0, cc-by, cc-by-sa, or public-domain`);
  }
  if (row.tags !== undefined) {
    if (!Array.isArray(row.tags) || row.tags.length > 8) {
      errors.push(`${where}.tags must be at most 8 slugs`);
    } else {
      const seen = new Set();
      for (const tag of row.tags) {
        if (typeof tag !== "string" || !ID_RE.test(tag) || tag.length > 32 || seen.has(tag)) {
          errors.push(`${where}.tags must be unique lowercase slugs`);
          break;
        }
        seen.add(tag);
      }
    }
  }
  if (row.added !== undefined) {
    // The UTC day the tape was filed; it airs from the next day so every open tab builds the same lineup.
    if (typeof row.added !== "string" || !isIsoDay(row.added)) {
      errors.push(`${where}.added must be a YYYY-MM-DD date (the day the tape was filed)`);
    }
  }
  for (const hosted of ["media", "poster", "media_bytes", "media_source"]) {
    if (row[hosted] !== undefined) errors.push(`${where}.${hosted} is not allowed: Plebflix does not host tape files`);
  }
  errors.push(...validatePlay(row, where, plays));
  if (row.creator !== undefined) {
    if (
      typeof row.creator !== "string" ||
      row.creator.trim().length < 1 ||
      row.creator.length > 80 ||
      /[\r\n]/.test(row.creator)
    ) {
      errors.push(`${where}.creator must be one line of 1–80 characters`);
    }
  }
  return errors;
}

/**
 * @param {unknown} doc
 * @param {string} [expectedId]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateChannel(doc, expectedId) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["Channel file must be a JSON object"] };
  }
  const channel = /** @type {Record<string, unknown>} */ (doc);
  if (typeof channel.id !== "string" || !ID_RE.test(channel.id)) {
    errors.push("id must be a lowercase slug");
  } else if (expectedId && channel.id !== expectedId) {
    errors.push(`id "${channel.id}" does not match ${expectedId}`);
  }
  if (typeof channel.number !== "number" || !Number.isInteger(channel.number) || channel.number < 1) {
    errors.push("number must be a positive integer");
  }
  if (typeof channel.name !== "string" || channel.name.trim().length < 1 || channel.name.length > 40) {
    errors.push("name must be 1–40 characters");
  }
  if (typeof channel.tagline !== "string" || channel.tagline.length > 160) {
    errors.push("tagline must be a string of at most 160 characters");
  }
  if (!Array.isArray(channel.items)) {
    errors.push("items must be an array");
    return { ok: false, errors };
  }
  const ids = new Set();
  const embeds = new Set();
  const plays = new Set();
  channel.items.forEach((item, index) => {
    errors.push(...validateItem(item, index, ids, embeds, plays));
  });
  const live = channel.items.filter(
    (item) => item && typeof item === "object" && item.status !== "pending" && item.duration > 0,
  );
  if (live.length < 1) errors.push("channel needs at least one playable item");
  return errors.length ? { ok: false, errors } : { ok: true };
}

const PLAY_KINDS = new Set(["youtube", "archive", "link"]);

/**
 * Required playback contract. The site never hosts the file: youtube, archive.org, or a link-out.
 * @param {Record<string, unknown>} row
 * @param {string} where
 * @param {Set<string>} plays
 * @returns {string[]}
 */
function validatePlay(row, where, plays) {
  const errors = [];
  const play = row.play;
  if (!play || typeof play !== "object" || Array.isArray(play)) {
    return [`${where}.play must be { kind, id_or_url, official, uploader }`];
  }
  const card = /** @type {Record<string, unknown>} */ (play);
  if (typeof card.kind !== "string" || !PLAY_KINDS.has(card.kind)) {
    errors.push(`${where}.play.kind must be youtube, archive, or link`);
  }
  if (typeof card.id_or_url !== "string" || card.id_or_url.length < 1 || card.id_or_url.length > 500) {
    errors.push(`${where}.play.id_or_url is missing`);
  } else if (card.kind === "youtube" && !/^[A-Za-z0-9_-]{6,32}$/.test(card.id_or_url)) {
    errors.push(`${where}.play.id_or_url is not a YouTube id`);
  } else if (card.kind === "archive" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(card.id_or_url)) {
    errors.push(`${where}.play.id_or_url is not an archive.org identifier`);
  } else if (card.kind === "link" && !isHttpUrl(card.id_or_url)) {
    errors.push(`${where}.play.id_or_url must be an http(s) URL`);
  } else {
    const key = `${card.kind}:${card.id_or_url}`;
    if (plays.has(key)) errors.push(`${where}.play "${card.id_or_url}" is duplicated`);
    else plays.add(key);
  }
  if (typeof card.official !== "boolean") errors.push(`${where}.play.official must be true or false`);
  if (
    typeof card.uploader !== "string" ||
    card.uploader.trim().length < 1 ||
    card.uploader.length > 120 ||
    /[\r\n]/.test(card.uploader)
  ) {
    errors.push(`${where}.play.uploader must be one line of 1–120 characters`);
  }
  if (card.kind === "youtube" && row.embedId && card.id_or_url && row.embedId !== card.id_or_url) {
    errors.push(`${where}.play.id_or_url must match embedId`);
  }
  if (card.kind === "archive" && row.embedId && card.id_or_url && row.embedId !== card.id_or_url) {
    errors.push(`${where}.play.id_or_url must match embedId`);
  }
  return errors;
}

/** @param {string} value */
export function isIsoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const SLOT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ORDERS = new Set(["seeded", "catalog"]);

/**
 * channels/schedule.json: `defaults` and one optional block per channel id. Slots must name a tape on that
 * channel's language shelf, start at a distinct UTC minute, and leave room for the tape before the next slot.
 * @param {unknown} doc
 * @param {Record<string, { items?: unknown[] }>} catalogs language id → channel file
 * @param {{ channels?: Array<{ id: string }>, assign?: Record<string, string[]> }} [categories]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateSchedule(doc, catalogs, categories) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["schedule.json must be a JSON object"] };
  }
  const file = /** @type {Record<string, unknown>} */ (doc);
  const knownChannels = new Set(Object.keys(catalogs));
  for (const lang of Object.keys(catalogs)) {
    for (const cat of categories?.channels || []) if (cat && typeof cat.id === "string") knownChannels.add(`${lang}-${cat.id}`);
  }
  const checkBlock = (block, where, channelId) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const row = /** @type {Record<string, unknown>} */ (block);
    for (const key of Object.keys(row)) {
      if (!["order", "hold_out_hours", "ident_seconds", "slots", "note"].includes(key)) errors.push(`${where}.${key} is not a schedule field`);
    }
    if (row.order !== undefined && !ORDERS.has(/** @type {string} */ (row.order))) errors.push(`${where}.order must be "seeded" or "catalog"`);
    if (row.hold_out_hours !== undefined && (typeof row.hold_out_hours !== "number" || row.hold_out_hours < 0 || row.hold_out_hours > 24)) {
      errors.push(`${where}.hold_out_hours must be a number from 0 to 24`);
    }
    if (row.ident_seconds !== undefined && (!Number.isInteger(row.ident_seconds) || row.ident_seconds < 1 || row.ident_seconds > 60)) {
      errors.push(`${where}.ident_seconds must be an integer from 1 to 60`);
    }
    if (row.slots === undefined) return;
    if (!Array.isArray(row.slots)) {
      errors.push(`${where}.slots must be an array`);
      return;
    }
    const lang = channelId ? channelId.split("-")[0] : "";
    const shelf = channelId ? catalogs[lang]?.items || [] : null;
    const cat = channelId && channelId.includes("-") ? channelId.slice(lang.length + 1) : "";
    const seen = new Map();
    const placed = [];
    row.slots.forEach((slot, index) => {
      const at = `${where}.slots[${index}]`;
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        errors.push(`${at} must be an object { at: "HH:MM", tape: "<id>" }`);
        return;
      }
      const entry = /** @type {Record<string, unknown>} */ (slot);
      if (typeof entry.at !== "string" || !SLOT_RE.test(entry.at)) errors.push(`${at}.at must be "HH:MM" in UTC (00:00–23:59)`);
      else if (seen.has(entry.at)) errors.push(`${at}.at ${entry.at} is used twice`);
      else seen.set(entry.at, index);
      if (typeof entry.tape !== "string" || entry.tape.length < 1) {
        errors.push(`${at}.tape must be a tape id`);
        return;
      }
      if (!shelf) return; // defaults: tapes cannot be checked against one shelf
      const tape = shelf.find((item) => item && typeof item === "object" && /** @type {{ id?: string }} */ (item).id === entry.tape);
      if (!tape) errors.push(`${at}.tape "${entry.tape}" is not on the ${lang} shelf`);
      else if (/** @type {{ status?: string }} */ (tape).status === "pending") errors.push(`${at}.tape "${entry.tape}" is still pending`);
      else if (cat && !(categories?.assign?.[entry.tape] || []).includes(cat)) errors.push(`${at}.tape "${entry.tape}" is not assigned to ${cat} in categories.json`);
      if (tape && typeof entry.at === "string" && SLOT_RE.test(entry.at)) {
        const [h, m] = entry.at.split(":").map(Number);
        placed.push({ at: h * 3600 + m * 60, duration: Number(/** @type {{ duration?: number }} */ (tape).duration) || 0, label: at });
      }
    });
    placed.sort((a, b) => a.at - b.at);
    for (let i = 0; i + 1 < placed.length; i += 1) {
      if (placed[i].at + placed[i].duration > placed[i + 1].at) errors.push(`${placed[i].label} runs into the next slot`);
    }
  };
  if (file.defaults !== undefined) checkBlock(file.defaults, "defaults", "");
  if (file.channels !== undefined) {
    if (!file.channels || typeof file.channels !== "object" || Array.isArray(file.channels)) errors.push("channels must be an object keyed by channel id");
    else {
      for (const [id, block] of Object.entries(file.channels)) {
        if (!knownChannels.has(id)) errors.push(`channels.${id} is not a channel (suomi, international, or <lang>-<category>)`);
        checkBlock(block, `channels.${id}`, knownChannels.has(id) ? id : "");
      }
    }
  }
  for (const key of Object.keys(file)) if (!["note", "defaults", "channels"].includes(key)) errors.push(`${key} is not a schedule.json field`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * channels/categories.json: the category list and the tape → categories map.
 * @param {unknown} doc
 * @param {Record<string, { items?: unknown[] }>} catalogs
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateCategories(doc, catalogs) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["categories.json must be a JSON object"] };
  }
  const file = /** @type {Record<string, unknown>} */ (doc);
  const ids = new Set();
  if (!Array.isArray(file.channels) || file.channels.length < 1) errors.push("channels must be a non-empty array");
  else {
    file.channels.forEach((cat, index) => {
      const where = `channels[${index}]`;
      const row = cat && typeof cat === "object" ? /** @type {Record<string, unknown>} */ (cat) : null;
      if (!row || typeof row.id !== "string" || !ID_RE.test(row.id)) {
        errors.push(`${where}.id must be a lowercase slug`);
        return;
      }
      if (ids.has(row.id)) errors.push(`${where}.id "${row.id}" is duplicated`);
      ids.add(row.id);
      for (const field of ["short", "name"]) {
        const value = row[field];
        const ok = typeof value === "string" ? value.trim().length > 0 : value && typeof value === "object" && typeof (/** @type {any} */ (value).international) === "string";
        if (!ok) errors.push(`${where}.${field} must be a string or { suomi, international }`);
      }
    });
  }
  const tapes = new Set();
  for (const shelf of Object.values(catalogs)) for (const item of shelf.items || []) if (item && typeof item === "object" && typeof (/** @type {any} */ (item).id) === "string") tapes.add(/** @type {any} */ (item).id);
  if (!file.assign || typeof file.assign !== "object" || Array.isArray(file.assign)) errors.push("assign must be an object: tape id → [category ids]");
  else {
    for (const [tapeId, list] of Object.entries(file.assign)) {
      if (!tapes.has(tapeId)) errors.push(`assign.${tapeId} is not a tape on either shelf`);
      if (!Array.isArray(list) || list.length < 1 || list.some((cat) => !ids.has(cat))) errors.push(`assign.${tapeId} must list known category ids`);
    }
    for (const tapeId of tapes) if (!(tapeId in file.assign)) errors.push(`assign is missing tape "${tapeId}" (every tape needs at least one category)`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** @param {string} value */
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const HOST_RE = /^[a-z0-9.-]+$/;

/**
 * @param {unknown} doc
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateSources(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["sources.json must be an object"] };
  }
  const file = /** @type {Record<string, unknown>} */ (doc);
  if (!Array.isArray(file.shelves) || file.shelves.length < 1) {
    errors.push("shelves must be a non-empty array");
  } else {
    const ids = new Set();
    file.shelves.forEach((shelf, index) => {
      errors.push(...validateShelf(shelf, index, ids));
    });
  }
  if (!Array.isArray(file.finds)) {
    errors.push("finds must be an array");
  } else {
    file.finds.forEach((find, index) => {
      const where = `finds[${index}]`;
      if (!find || typeof find !== "object") {
        errors.push(`${where} must be an object`);
        return;
      }
      const row = /** @type {Record<string, unknown>} */ (find);
      if (typeof row.title !== "string" || row.title.trim().length < 1 || row.title.length > 160) {
        errors.push(`${where}.title must be 1–160 characters`);
      }
      if (typeof row.url !== "string" || !isHttps(row.url) || row.url.length > 500) {
        errors.push(`${where}.url must be an https URL`);
      }
      if (typeof row.note !== "string" || row.note.length > 400) {
        errors.push(`${where}.note must be a string of at most 400 characters`);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * @param {unknown} shelf
 * @param {number} index
 * @param {Set<string>} ids
 */
function validateShelf(shelf, index, ids) {
  const where = `shelves[${index}]`;
  const errors = [];
  if (!shelf || typeof shelf !== "object" || Array.isArray(shelf)) {
    return [`${where} must be an object`];
  }
  const row = /** @type {Record<string, unknown>} */ (shelf);
  if (typeof row.id !== "string" || !ID_RE.test(row.id)) {
    errors.push(`${where}.id must be a lowercase slug`);
  } else if (ids.has(row.id)) {
    errors.push(`${where}.id is duplicated`);
  } else {
    ids.add(row.id);
  }
  if (typeof row.name !== "string" || row.name.trim().length < 1 || row.name.length > 120) {
    errors.push(`${where}.name must be 1–120 characters`);
  }
  if (typeof row.url !== "string" || !isHttps(row.url) || row.url.length > 500) {
    errors.push(`${where}.url must be an https URL`);
  }
  if (typeof row.about !== "string" || row.about.length > 400) {
    errors.push(`${where}.about must be a string of at most 400 characters`);
  }
  if (!Array.isArray(row.hosts)) {
    errors.push(`${where}.hosts must be an array`);
  } else {
    for (const host of row.hosts) {
      if (typeof host !== "string" || !HOST_RE.test(host)) {
        errors.push(`${where}.hosts must be lowercase hostnames`);
        break;
      }
    }
  }
  if (row.subdomains !== undefined && typeof row.subdomains !== "boolean") {
    errors.push(`${where}.subdomains must be a boolean`);
  }
  if (row.links !== undefined) {
    if (!Array.isArray(row.links)) {
      errors.push(`${where}.links must be an array`);
    } else {
      row.links.forEach((link, linkIndex) => {
        if (!link || typeof link !== "object") {
          errors.push(`${where}.links[${linkIndex}] must be an object`);
          return;
        }
        const item = /** @type {Record<string, unknown>} */ (link);
        if (typeof item.label !== "string" || item.label.length < 1 || item.label.length > 160) {
          errors.push(`${where}.links[${linkIndex}].label must be 1–160 characters`);
        }
        if (typeof item.url !== "string" || !isHttps(item.url) || item.url.length > 500) {
          errors.push(`${where}.links[${linkIndex}].url must be an https URL`);
        }
      });
    }
  }
  return errors;
}

/** @param {string} value */
function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

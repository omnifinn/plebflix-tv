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
export function validateItem(item, index, ids, embeds) {
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
  channel.items.forEach((item, index) => {
    errors.push(...validateItem(item, index, ids, embeds));
  });
  const live = channel.items.filter(
    (item) => item && typeof item === "object" && item.status !== "pending" && item.duration > 0,
  );
  if (live.length < 1) errors.push("channel needs at least one playable item");
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

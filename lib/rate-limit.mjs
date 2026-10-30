/**
 * @param {{ limit?: number, windowMs?: number }} [options]
 */
export function createRateLimiter({ limit = 5, windowMs = 60 * 60 * 1000, prefix = "rl" } = {}) {
  /** @type {Map<string, { count: number, reset: number }>} */
  const memory = new Map();

  return {
    reset() {
      memory.clear();
    },
    /**
     * @param {string} ip
     * @param {{ get: Function, put: Function } | undefined} kv
     * @param {number} [now]
     */
    async allow(ip, kv, now = Date.now()) {
      if (kv) return allowKv(kv, `${prefix}:${ip}`, now, limit, windowMs);
      return allowMemory(memory, ip, now, limit, windowMs);
    },
  };
}

/**
 * @param {Map<string, { count: number, reset: number }>} memory
 * @param {string} ip
 * @param {number} now
 * @param {number} limit
 * @param {number} windowMs
 */
function allowMemory(memory, ip, now, limit, windowMs) {
  // The map lives as long as the isolate; sweep expired entries before it can grow without bound.
  if (memory.size > 50_000) {
    for (const [key, entry] of memory) if (now >= entry.reset) memory.delete(key);
  }
  const current = memory.get(ip);
  if (!current || now >= current.reset) {
    memory.set(ip, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((current.reset - now) / 1000) };
  }
  current.count += 1;
  return { ok: true, remaining: limit - current.count };
}

/**
 * @param {{ get: Function, put: Function }} kv
 * @param {string} ip
 * @param {number} now
 * @param {number} limit
 * @param {number} windowMs
 */
async function allowKv(kv, key, now, limit, windowMs) {
  const current = await kv.get(key, "json");
  if (!current || typeof current.count !== "number" || now >= current.reset) {
    await kv.put(key, JSON.stringify({ count: 1, reset: now + windowMs }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });
    return { ok: true, remaining: limit - 1 };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((current.reset - now) / 1000) };
  }
  const count = current.count + 1;
  const ttl = Math.max(60, Math.ceil((current.reset - now) / 1000));
  await kv.put(key, JSON.stringify({ count, reset: current.reset }), { expirationTtl: ttl });
  return { ok: true, remaining: limit - count };
}

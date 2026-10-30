// The viewer's address, reduced to something safe to store: IPv6 is cut to its /64 (one home or
// one phone, however many addresses it rotates through), then salted and hashed. Without the
// IP_SALT secret the hash cannot be walked back to an address by brute force.

/** @param {Request} request */
export function clientIp(request) {
  const raw = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "local";
  return raw.split(",")[0].trim() || "local";
}

/** IPv4 stays as is; IPv6 becomes its /64 prefix; an IPv4-mapped IPv6 address becomes the IPv4. */
export function normalizeIp(ip) {
  const s = String(ip || "").trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!s.includes(":")) return s;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1];
  const [head, tail = ""] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  if (fill < 0) return s;
  const parts = [...h, ...Array(fill).fill("0"), ...t];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return s;
  return `${parts.slice(0, 4).map((p) => p.padStart(4, "0")).join(":")}::/64`;
}

/** @param {string} ip @param {string} [salt] */
export async function hashIp(ip, salt = "plebflix") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${normalizeIp(ip)}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** The stored key for this request's address. `IP_SALT` is an optional Worker secret. */
export function ipKey(request, env = {}) {
  return hashIp(clientIp(request), typeof env.IP_SALT === "string" && env.IP_SALT ? env.IP_SALT : "plebflix");
}

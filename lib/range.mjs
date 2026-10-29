// Static assets on Workers answer Range requests with a full 200, which stops
// browsers from seeking inside a tape. This turns that into a proper 206.
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

function sliceStream(body, start, end) {
  let pos = 0;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctrl.close(); return; }
        const s = pos, e = pos + value.byteLength; pos = e;
        if (e <= start) continue;
        const a = Math.max(0, start - s), b = Math.min(value.byteLength, end + 1 - s);
        if (b > a) ctrl.enqueue(value.subarray(a, b));
        if (pos > end) { ctrl.close(); reader.cancel().catch(() => {}); return; }
        return;
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
}

// The edge cache answers Range natively and without touching bytes in JS, so
// it is tried first; the full file is put there once per data centre.
// Safari is strict: it wants Accept-Ranges, an exact Content-Length and video/mp4.
function finish(res, head) {
  const headers = new Headers(res.headers);
  headers.set("accept-ranges", "bytes");
  if (!headers.get("content-type") || headers.get("content-type") === "application/octet-stream") headers.set("content-type", "video/mp4");
  headers.delete("content-encoding");
  if (head) { res.body?.cancel(); return new Response(null, { status: res.status, headers }); }
  return new Response(res.body, { status: res.status, headers });
}

export async function serveMedia(request, assets, cache = globalThis.caches?.default, waitUntil = null) {
  const range = request.headers.get("range");
  const head = request.method === "HEAD";
  let res = null;
  if (cache && (request.method === "GET" || head)) {
    try {
      // Cache entries are keyed by the asset's ETag, so a re-encoded tape (same URL, new bytes) or a
      // removed one never comes back stale from the edge cache.
      const meta = await assets.fetch(new Request(request.url, { method: "HEAD" }));
      if (!meta.ok) return meta;
      const tag = (meta.headers.get("etag") || "").replace(/[^\w-]/g, "");
      const url = new URL(request.url);
      if (tag) url.searchParams.set("v", tag);
      const key = new Request(url.toString(), { method: "GET" });
      const probe = new Request(url.toString(), { method: "GET", headers: range ? { range } : {} });
      const hit = await cache.match(probe);
      if (hit) return finish(hit, head);
      const full = await assets.fetch(new Request(request.url, { method: "GET" }));
      if (!full.ok || !full.body) return full;
      if (waitUntil) {
        // Answer this (first, uncached) request straight away and fill the edge cache behind it,
        // so Safari's opening bytes=0-1 probe never waits for a 25 MiB cache write.
        waitUntil(cache.put(key, full.clone()).catch(() => {}));
        res = full;
      } else {
        await cache.put(key, full);
        const again = await cache.match(probe);
        if (again) return finish(again, head);
      }
    } catch (err) {
      res = null; // fall through to the in-Worker slicer
    }
  }
  if (!res) res = await assets.fetch(new Request(request.url, { method: head ? "HEAD" : "GET" }));
  if (!res.ok) return res;
  if (!range) return finish(res, head);
  let size = Number(res.headers.get("content-length"));
  let buf = null;
  if (!size) {
    // No length on the asset response: buffer it (tapes are capped at 25 MiB).
    if (request.method === "HEAD") return res;
    buf = new Uint8Array(await res.arrayBuffer());
    size = buf.byteLength;
  }
  const r = parseRange(range, size);
  if (!r) return buf ? new Response(buf, { status: 200, headers: res.headers }) : res;
  const headers = new Headers(res.headers);
  headers.set("accept-ranges", "bytes");
  if (r === "unsatisfiable") {
    if (!buf) res.body?.cancel();
    headers.set("content-range", `bytes */${size}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${r.start}-${r.end}/${size}`);
  headers.set("content-length", String(r.end - r.start + 1));
  const body = request.method === "HEAD" ? null
    : buf ? buf.slice(r.start, r.end + 1)
    : res.body ? sliceStream(res.body, r.start, r.end) : null;
  return new Response(body, { status: 206, headers });
}

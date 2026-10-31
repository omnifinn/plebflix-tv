import { suomiPage } from "../lib/suomi-page.mjs";
import { handleSubmit } from "../lib/submissions.mjs";
import { handleImpression, handleStats, handleVote } from "../lib/votes.mjs";

// Ask ASSETS for the extensionless path. Fetching /credits.html gets a 307 back to /credits,
// and run_worker_first would send that redirect through this worker again.
const PAGES: Record<string, string> = {
  "/credits": "/credits",
  "/credits/": "/credits",
  "/takedown": "/takedown",
  "/takedown/": "/takedown",
};

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/recommend" || url.pathname === "/api/submit") {
      return handleSubmit(request, env);
    }
    if (url.pathname === "/api/vote") {
      return handleVote(request, env);
    }
    if (url.pathname === "/api/impression") {
      return handleImpression(request, env);
    }
    if (url.pathname === "/api/geo") {
      const country = String((request as any).cf?.country || "").toUpperCase();
      return new Response(JSON.stringify({ country, tv: country === "FI" ? "suomi" : "international" }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    if (url.pathname === "/api/stats") {
      return handleStats(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ ok: false, error: "No such tape slot." }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const page = PAGES[url.pathname];
    if (page) {
      return env.ASSETS.fetch(new Request(new URL(page, url), request));
    }
    if (url.pathname === "/suomi" || url.pathname === "/suomi/") {
      const shell = await env.ASSETS.fetch(new Request(new URL("/", url), { headers: { accept: "text/html" } }));
      if (!shell.ok) return shell;
      const html = (suomiPage as any)(await shell.text());
      const headers = new Headers(shell.headers);
      headers.delete("content-length");
      headers.delete("etag");
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "public, max-age=0, must-revalidate");
      return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
    }
    return env.ASSETS.fetch(request);
  },
};

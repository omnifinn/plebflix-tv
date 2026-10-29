import { handleRecommend } from "../lib/recommend.mjs";
import { handleImpression, handleStats, handleVote } from "../lib/votes.mjs";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/recommend") {
      return handleRecommend(request, env);
    }
    if (url.pathname === "/api/vote") {
      return handleVote(request, env);
    }
    if (url.pathname === "/api/impression") {
      return handleImpression(request, env);
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
    return env.ASSETS.fetch(request);
  },
};

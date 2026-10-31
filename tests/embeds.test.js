import assert from "node:assert/strict";
import test from "node:test";
import { playback, rightsLine, watchUrl } from "../public/play.js";
import { checkTape } from "../scripts/check-embeds.mjs";

test("playback reads the play contract and never a local file", () => {
  const youtube = playback({
    source: "youtube",
    embedId: "aaaaaaaaaaa",
    media: "/media/international/x.mp4",
    play: { kind: "youtube", id_or_url: "bbbbbbbbbbb", official: true, uploader: "Ada" },
  });
  assert.deepEqual(youtube, { kind: "youtube", id: "bbbbbbbbbbb", official: true, uploader: "Ada" });
  assert.equal(watchUrl({ play: { kind: "archive", id_or_url: "thd", official: false, uploader: "Legotronn" } }), "https://archive.org/details/thd");
  assert.equal(rightsLine({ play: { kind: "youtube", id_or_url: "bbbbbbbbbbb", official: true, uploader: "Ada" } }), "embedded via YouTube");
  assert.equal(rightsLine({ license: "cc0", play: { kind: "link", id_or_url: "https://example.com", official: false, uploader: "x" } }), "cc0");
  const link = playback({ original_url: "https://example.com/tape" });
  assert.equal(link.kind, "link");
  assert.equal(link.id, "https://example.com/tape");
});

test("check-embeds accepts a live YouTube oEmbed and an archive.org item, and skips link-only", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("youtube.com/oembed") && href.includes("abcdefghijk")) {
      return new Response(JSON.stringify({ title: "Ok", author_name: "Ada" }), { status: 200 });
    }
    if (href.includes("youtube.com/oembed")) return new Response("no", { status: 401 });
    if (href.includes("noembed.com") && href.includes("deaddeaddead")) {
      return new Response(JSON.stringify({ error: "401 Unauthorized" }), { status: 200 });
    }
    if (href.includes("archive.org/metadata/thd")) {
      return new Response(JSON.stringify({ metadata: { identifier: "thd" } }), { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };
  const live = await checkTape(
    { id: "ok", play: { kind: "youtube", id_or_url: "abcdefghijk", official: true, uploader: "Ada" } },
    fetchImpl,
  );
  assert.equal(live.ok, true);
  const dead = await checkTape(
    { id: "gone", title: "Gone", play: { kind: "youtube", id_or_url: "deaddeaddead", official: false, uploader: "x" } },
    fetchImpl,
  );
  assert.equal(dead.ok, false);
  const archive = await checkTape(
    { id: "ham", play: { kind: "archive", id_or_url: "thd", official: false, uploader: "Legotronn" } },
    fetchImpl,
  );
  assert.equal(archive.ok, true);
  const link = await checkTape(
    { id: "doge", play: { kind: "link", id_or_url: "https://knowyourmeme.com/memes/doge", official: false, uploader: "Know Your Meme" } },
    fetchImpl,
  );
  assert.equal(link.ok, true);
  assert.equal(link.kind, "link");
});

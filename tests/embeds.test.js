import assert from "node:assert/strict";
import test from "node:test";
import { archiveFile, playback, rightsLine, sources, watchUrl } from "../public/play.js";
import { checkTape } from "../scripts/check-embeds.mjs";

test("sources reads the ordered play list and never a local file", () => {
  const item = {
    source: "youtube",
    embedId: "aaaaaaaaaaa",
    media: "/media/international/x.mp4",
    play: [
      { kind: "youtube", id_or_url: "bbbbbbbbbbb", official: true, uploader: "Ada" },
      { kind: "archive", id_or_url: "youtube-bbbbbbbbbbb", file: "a b.mp4", official: false, uploader: "Archive Team" },
      { kind: "link", id_or_url: "https://example.com", official: false, uploader: "x" },
    ],
  };
  assert.deepEqual(sources(item).map((source) => source.kind), ["youtube", "archive"]);
  assert.equal(playback(item).id, "bbbbbbbbbbb");
  assert.equal(archiveFile(sources(item)[1]), "https://archive.org/download/youtube-bbbbbbbbbbb/a%20b.mp4");
  assert.equal(watchUrl({ play: [{ kind: "archive", id_or_url: "thd", official: false, uploader: "Legotronn" }] }), "https://archive.org/details/thd");
  assert.equal(rightsLine({ play: [{ kind: "youtube", id_or_url: "bbbbbbbbbbb", official: true, uploader: "Ada" }] }), "embedded via YouTube");
  assert.equal(rightsLine({ license: "cc0", play: [{ kind: "image", id_or_url: "https://i.kym-cdn.com/x.jpg", official: false, uploader: "x" }] }), "cc0");
  assert.equal(sources({ original_url: "https://example.com/tape" }).length, 0);
});

test("check-embeds passes a tape with one live source and fails a tape with none", async () => {
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
      return new Response(JSON.stringify({ metadata: { identifier: "thd" }, files: [{ name: "thd.mp4" }] }), { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };
  const live = await checkTape(
    { id: "ok", play: [{ kind: "youtube", id_or_url: "abcdefghijk", official: true, uploader: "Ada" }] },
    fetchImpl,
  );
  assert.equal(live.ok, true);
  const dead = await checkTape(
    { id: "gone", title: "Gone", play: [{ kind: "youtube", id_or_url: "deaddeaddead", official: false, uploader: "x" }] },
    fetchImpl,
  );
  assert.equal(dead.ok, false);
  const archive = await checkTape(
    { id: "ham", play: [{ kind: "youtube", id_or_url: "deaddeaddead", official: false, uploader: "x" }, { kind: "archive", id_or_url: "thd", file: "thd.mp4", official: false, uploader: "Legotronn" }] },
    fetchImpl,
  );
  assert.equal(archive.ok, true);
  assert.equal(archive.onlyYoutube, false);
  const none = await checkTape({ id: "doge", original_url: "https://knowyourmeme.com/memes/doge" }, fetchImpl);
  assert.equal(none.ok, false);
  assert.equal(none.detail, "no sources");
});

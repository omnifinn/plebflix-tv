/**
 * Every place a tape can play, best first. `play` on the shelf is the contract. Nothing is hosted here:
 * youtube is the IFrame player, archive is a file streamed from archive.org, wayback is the Internet Archive's copy
 * of that YouTube upload, image is a still from its public host.
 * @param {any} item
 * @returns {Array<{ kind: "youtube" | "vimeo" | "archive" | "wayback" | "image", id: string, file: string, at: string, official: boolean, uploader: string }>}
 */
export function sources(item) {
  const list = Array.isArray(item?.play) ? item.play : item?.play ? [item.play] : [];
  const out = [];
  for (const play of list) {
    if (!["youtube", "vimeo", "archive", "wayback", "image"].includes(play?.kind)) continue;
    out.push({
      kind: play.kind,
      id: String(play.id_or_url || ""),
      file: typeof play.file === "string" ? play.file : "",
      at: typeof play.at === "string" ? play.at : "",
      official: play.official === true,
      uploader: typeof play.uploader === "string" ? play.uploader : "",
    });
  }
  if (out.length) return out;
  if (item?.source === "youtube" && item.embedId) {
    return [{ kind: "youtube", id: String(item.embedId), file: "", at: "", official: false, uploader: "" }];
  }
  return [];
}

/** The tape's first source, or an empty one. */
export function playback(item) {
  return sources(item)[0] || { kind: "", id: "", file: "", at: "", official: false, uploader: "" };
}

/** The file a browser streams from archive.org. */
export function archiveFile(source) {
  if (source.kind === "wayback") return `https://web.archive.org/web/${source.at || "2"}oe_/http://wayback-fakeurl.archive.org/yt/${encodeURIComponent(source.id)}`;
  return `https://archive.org/download/${encodeURIComponent(source.id)}/${source.file.split("/").map(encodeURIComponent).join("/")}`;
}

/** YouTube's own poster. Never a frame we downloaded. */
export function youtubePoster(id, size = "hqdefault") {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;
}

/** Licence string, or the embed credit the credits page prints when the tape has no licence. */
export function rightsLine(item) {
  if (typeof item?.license === "string" && item.license) return item.license;
  const kind = playback(item).kind;
  if (kind === "youtube") return "embedded via YouTube";
  if (kind === "vimeo") return "embedded via Vimeo";
  if (kind === "archive" || kind === "wayback") return "streamed from Internet Archive";
  if (kind === "image") return "image from its public source";
  return "no source";
}

/** Page a person can open for this tape: the watch page, the archive details page, or the link-out. */
export function watchUrl(item) {
  const play = playback(item);
  if (play.kind === "youtube" && play.id) return `https://www.youtube.com/watch?v=${play.id}`;
  if (play.kind === "wayback" && play.id) return `https://www.youtube.com/watch?v=${play.id}`;
  if (play.kind === "archive" && play.id) return `https://archive.org/details/${encodeURIComponent(play.id)}`;
  return item?.original_url || "";
}

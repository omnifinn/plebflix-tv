/**
 * How a tape plays. `play` on the shelf is the contract. A local file is never a source.
 * @param {any} item
 * @returns {{ kind: "youtube" | "archive" | "link", id: string, official: boolean, uploader: string }}
 */
export function playback(item) {
  const play = item?.play;
  if (play && (play.kind === "youtube" || play.kind === "archive" || play.kind === "link")) {
    return {
      kind: play.kind,
      id: String(play.id_or_url || ""),
      official: play.official === true,
      uploader: typeof play.uploader === "string" ? play.uploader : "",
    };
  }
  if (item?.source === "youtube" && item.embedId) {
    return { kind: "youtube", id: String(item.embedId), official: false, uploader: "" };
  }
  if (item?.source === "archive.org" && item.embedId) {
    return { kind: "archive", id: String(item.embedId), official: false, uploader: "" };
  }
  return { kind: "link", id: String(item?.original_url || item?.credit || ""), official: false, uploader: "" };
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
  if (kind === "archive") return "embedded via Internet Archive";
  return "link only";
}

/** Page a person can open for this tape: the watch page, the archive details page, or the link-out. */
export function watchUrl(item) {
  const play = playback(item);
  if (play.kind === "youtube" && play.id) return `https://www.youtube.com/watch?v=${play.id}`;
  if (play.kind === "archive" && play.id) return `https://archive.org/details/${encodeURIComponent(play.id)}`;
  return play.id || item?.original_url || "";
}

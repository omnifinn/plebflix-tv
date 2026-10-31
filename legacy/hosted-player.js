// Retired 2026-10-31. The live deck never plays a local file and does not use a Vimeo iframe.
// Kept whole (zero-loss). Nothing imports this file.
// playVideo served /media/* in <video>. playIframe embedded Vimeo and archive.org without the player API.
// The current archive path is playArchive in public/app.js (seek by reloading the iframe).

function stopVideo() {
  if (!vid) return;
  vid.pause();
  vid.hidden = true;
  vid.onended = vid.onerror = vid.onplaying = null;
  if (vid.getAttribute("src")) {
    vid.removeAttribute("src");
    vid.load();
  }
}

/** Self-hosted tape: <video> from /media. Falls back to the embed on error. */
function playVideo(item, offset, gen, onEnded) {
  destroyYoutube();
  hideEmbed();
  destroySwf();
  playerKind = "video";
  vid.hidden = false;
  vid.muted = !soundOn;
  vid.onerror = () => {
    if (gen !== loadGen) return;
    brokenMedia.add(item.media);
    // Clear the deck so loadCurrent(true) reloads this spot through the embed instead of re-seeking the dead file.
    stopVideo();
    playerKind = "";
    if (onEnded) onEnded();
    else loadCurrent(true);
  };
  vid.onended = () => {
    if (gen !== loadGen) return;
    if (onEnded) onEnded();
    else if (mode !== "paused" && mode !== "stopped") advance("end");
  };
  vid.onplaying = () => {
    $("poster").style.opacity = "0";
    streak = 0;
  };
  if (vid.getAttribute("src") !== item.media) vid.src = item.media;
  const start = () => {
    try {
      if (Math.abs(vid.currentTime - offset) > 0.75) vid.currentTime = Math.max(0, offset);
    } catch {
      /* not seekable yet */
    }
    if (mode === "paused") return;
    const attempt = vid.play();
    attempt?.catch?.(() => {
      // Autoplay with sound refused: retry muted and ask for a tap.
      vid.muted = true;
      soundOn = false;
      $("sound-hint").hidden = false;
      vid.play().catch(() => {});
    });
  };
  if (vid.readyState >= 1) start();
  else vid.addEventListener("loadedmetadata", start, { once: true });
}

function playIframe(item, offset) {
  stopVideo();
  destroyYoutube();
  destroySwf();
  const frame = $("embed");
  const sec = Math.max(0, Math.floor(offset));
  const muted = soundOn ? "0" : "1";
  let src = "";
  if (item.source === "vimeo") {
    src = `https://player.vimeo.com/video/${item.embedId}?autoplay=1&muted=${muted}&playsinline=1#t=${sec}s`;
  } else if (item.source === "archive.org") {
    src = `https://archive.org/embed/${encodeURIComponent(item.embedId)}?autoplay=1&start=${sec}`;
  } else {
    advance("error");
    return;
  }
  frame.hidden = false;
  frame.src = src;
  playerKind = "iframe";
}

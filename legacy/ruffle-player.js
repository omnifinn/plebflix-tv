// Retired 2026-10-31. The live deck does not play SWF. Play kinds are youtube, archive, and link.
// Kept whole (zero-loss). Nothing in src/ or public/ imports this file.
// These functions closed over the old deck ($, playerKind, loadGen, mode, advance, hideEmbed, destroyYoutube).

function destroySwf() {
  const mount = document.getElementById("swf");
  if (!mount) return;
  mount.replaceChildren();
  mount.hidden = true;
}

const SWF_LICENSES = new Set(["cc0", "cc-by", "cc-by-sa", "public-domain"]);

function licensedSwf(item) {
  return SWF_LICENSES.has(item?.license) && /^https:\/\/\S+\.swf(?:$|[?#])/i.test(item?.embedId || "");
}

let rufflePromise = null;

function loadRuffle() {
  if (window.RufflePlayer) return Promise.resolve();
  if (!rufflePromise) {
    rufflePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@ruffle-rs/ruffle";
      script.onload = () => resolve();
      script.onerror = () => {
        rufflePromise = null;
        reject(new Error("ruffle"));
      };
      document.head.appendChild(script);
    });
  }
  return rufflePromise;
}

async function playSwf(item, gen) {
  destroyYoutube();
  hideEmbed();
  if (!licensedSwf(item)) {
    if (gen === loadGen) advance("error");
    return;
  }
  try {
    await loadRuffle();
  } catch {
    if (gen === loadGen) advance("error");
    return;
  }
  if (gen !== loadGen || mode === "stopped") return;
  const mount = $("swf");
  mount.hidden = false;
  mount.replaceChildren();
  const engine = window.RufflePlayer.newest();
  const swf = engine.createPlayer();
  swf.style.width = "100%";
  swf.style.height = "100%";
  mount.append(swf);
  playerKind = "ruffle";
  try {
    await swf.load({ url: item.embedId, autoplay: "on", unmuteOverlay: "hidden", wmode: "opaque" });
  } catch {
    if (gen === loadGen) advance("error");
  }
}

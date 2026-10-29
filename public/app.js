import { buildBroadcast, dayKey, liveSeconds, spotAt, shiftFromLive, totalDuration } from "./schedule.js";

const ORDER = ["suomi", "international"];
const CHANNEL_KEY = "plebflix-channel";
const SOUND_KEY = "plebflix-sound";

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const channels = new Map();
const statsMap = {};
const impressed = new Set();
let broadcastCache = null;
let channelId = "suomi";
let mode = "live";
let anchorPos = 0;
let anchorWall = 0;
let pausePos = 0;
let player = null;
let playerKind = "";
let loadedKey = "";
let ignoreUntil = 0;
let streak = 0;
let brokenHold = false;
let seekingDir = 0;
let seekTimer = 0;
let seekStep = 15;
let glitchTimer = 0;
let loadGen = 0;
let apiPromise = null;
let soundOn = false;

try {
  soundOn = sessionStorage.getItem(SOUND_KEY) === "1";
} catch {
  soundOn = false;
}

const snow = $("snow");
const snowCtx = snow.getContext("2d", { alpha: false });
let snowTimer = 0;

function wallSec() {
  return Math.floor(Date.now() / 1000);
}

function viewerId() {
  const key = "plebflix-viewer";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "local-viewer";
  }
}

function savedVotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem("plebflix-votes") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function playlist() {
  const channel = channels.get(channelId);
  if (!channel) return [];
  const day = dayKey(Date.now());
  const stats = statsMap[channelId] || {};
  const sig = JSON.stringify(stats);
  if (!broadcastCache || broadcastCache.id !== channelId || broadcastCache.day !== day || broadcastCache.sig !== sig) {
    broadcastCache = {
      id: channelId,
      day,
      sig,
      items: buildBroadcast(channel, Date.now(), stats),
    };
  }
  return broadcastCache.items;
}

function position() {
  const items = playlist();
  if (!items.length || mode === "stopped") return 0;
  if (mode === "paused") return pausePos;
  if (mode === "live") return liveSeconds(items, Date.now());
  const total = totalDuration(items);
  const elapsed = wallSec() - anchorWall;
  return ((anchorPos + elapsed) % total + total) % total;
}

function setTimeshift(seconds) {
  const total = totalDuration(playlist()) || 1;
  anchorPos = ((seconds % total) + total) % total;
  anchorWall = wallSec();
  mode = "timeshift";
  brokenHold = false;
}

function goLive() {
  mode = "live";
  brokenHold = false;
  streak = 0;
}

function clock() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function fmt(seconds) {
  const abs = Math.abs(Math.round(seconds));
  return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

function modeLabel() {
  if ($("rec-dialog").open) return "REC ●";
  if (seekingDir < 0) return "REW ◀◀";
  if (seekingDir > 0) return "FWD ▶▶";
  if (mode === "paused") return "PAUSE ❚❚";
  if (mode === "stopped") return "STOP ■";
  return "PLAY ▶";
}

function updateChrome(spot) {
  const channel = channels.get(channelId);
  const number = String(channel?.number || 1).padStart(2, "0");
  const short = channelId === "international" ? "INTL" : "SUOMI";
  const title = spot?.item?.title || (mode === "stopped" ? "NO SIGNAL" : "NO TAPE");
  const label = modeLabel();
  $("osd-ch").textContent = `CH ${number}`;
  $("osd-clock").textContent = clock();
  $("osd-mode").textContent = label;
  $("osd-title").textContent = title;
  $("lcd-ch").textContent = `CH ${number}`;
  $("lcd-clock").textContent = clock();
  $("lcd-mode").textContent = label.split(" ")[0];
  $("lcd-title").textContent = title;
  $("bezel-ch").textContent = `${number} ${short}`;
  $("tuner-name").textContent = short;
  $("power-led").classList.add("on");
  $("power-led").classList.toggle("paused", mode === "paused");
  const upButton = $("btn-up");
  const downButton = $("btn-down");
  if (upButton && downButton) {
    const vote = spot?.item && spot.item.kind !== "ident" ? savedVotes()[spot.item.id] : "";
    upButton.setAttribute("aria-pressed", vote === "up" ? "true" : "false");
    downButton.setAttribute("aria-pressed", vote === "down" ? "true" : "false");
  }
  $("btn-play").setAttribute("aria-pressed", mode === "live" || mode === "timeshift" ? "true" : "false");
  $("btn-pause").setAttribute("aria-pressed", mode === "paused" ? "true" : "false");
  $("btn-stop").setAttribute("aria-pressed", mode === "stopped" ? "true" : "false");
  for (const tape of document.querySelectorAll(".tape")) {
    tape.classList.toggle("in", tape.dataset.channel === channelId);
  }
  const items = playlist();
  const total = totalDuration(items);
  const here = mode === "stopped" ? 0 : position();
  const delta = total ? shiftFromLive(here, liveSeconds(items, Date.now()), total) : 0;
  const pill = $("live-pill");
  if (mode === "live") pill.textContent = "LIVE";
  else if (mode === "stopped") pill.textContent = "STOP";
  else if (mode === "paused" && Math.abs(delta) < 2) pill.textContent = "PAUSE";
  else pill.textContent = `TIMESHIFT ${delta >= 0 ? "+" : "−"}${fmt(delta)}`;
  $("sound-hint").hidden = soundOn;
  const source = $("osd-source");
  const url = mode !== "stopped" && spot?.item?.kind !== "ident" ? spot?.item?.original_url : "";
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    source.hidden = false;
    source.href = url;
  } else {
    source.hidden = true;
    source.removeAttribute("href");
  }
}

function showCard(text) {
  const card = $("card");
  card.hidden = false;
  card.classList.remove("ident");
  $("card-mark").textContent = "PLEBFLIX";
  $("card-sub").textContent = text;
}

function hideCard() {
  $("card").hidden = true;
  $("card").classList.remove("ident");
}

function showIdent(item) {
  destroyYoutube();
  hideEmbed();
  destroySwf();
  $("poster").hidden = true;
  const card = $("card");
  card.hidden = false;
  card.classList.add("ident");
  $("card-mark").textContent = item.title || "PLEBFLIX";
  $("card-sub").textContent = item.line || "STATION ID";
  streak = 0;
  playerKind = "ident";
}

function showPoster(item) {
  const poster = $("poster");
  poster.hidden = false;
  poster.style.opacity = "1";
  if (item.source === "youtube") {
    poster.src = `https://i.ytimg.com/vi/${item.embedId}/hqdefault.jpg`;
    poster.onerror = () => {
      poster.onerror = null;
      poster.src = `https://i.ytimg.com/vi/${item.embedId}/mqdefault.jpg`;
    };
  } else if (item.source === "archive.org") {
    poster.onerror = null;
    poster.src = `https://archive.org/services/img/${item.embedId}`;
  } else {
    poster.removeAttribute("src");
  }
}

function drawSnow() {
  if (!snow.classList.contains("on") || reduceMotion) return;
  const image = snowCtx.createImageData(snow.width, snow.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  snowCtx.putImageData(image, 0, 0);
}

function glitch() {
  if (reduceMotion) return;
  const layer = $("glitch");
  layer.classList.remove("on");
  void layer.offsetWidth;
  layer.classList.add("on");
  snow.classList.add("on");
  clearTimeout(glitchTimer);
  glitchTimer = setTimeout(() => {
    layer.classList.remove("on");
    if (mode !== "stopped") snow.classList.remove("on");
  }, 680);
}

function ensureYtDiv() {
  let mount = document.getElementById("yt");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "yt";
    $("poster").after(mount);
  }
  mount.hidden = false;
  return mount;
}

function hideEmbed() {
  const frame = $("embed");
  frame.hidden = true;
  frame.removeAttribute("src");
}

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

function destroyYoutube() {
  const dying = player;
  player = null;
  playerKind = "";
  if (dying && typeof dying.destroy === "function") {
    try {
      dying.destroy();
    } catch {
      /* the iframe may already be gone */
    }
  }
  document.getElementById("yt")?.remove();
}

function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("youtube api")), 12000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("youtube api"));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

function unlockSound() {
  soundOn = true;
  try {
    sessionStorage.setItem(SOUND_KEY, "1");
  } catch {
    /* private mode */
  }
  $("sound-hint").hidden = true;
  if (player && typeof player.unMute === "function") {
    player.unMute();
    player.setVolume(100);
  }
  const frame = $("embed");
  if (playerKind === "iframe" && frame?.contentWindow) {
    frame.contentWindow.postMessage(JSON.stringify({ method: "setVolume", value: 1 }), "*");
  }
}

function playIframe(item, offset) {
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

function onReady(event) {
  player = event?.target || player;
  streak = 0;
  if (mode === "paused") player?.pauseVideo?.();
  if (soundOn) {
    player?.unMute?.();
    player?.setVolume?.(100);
  } else {
    player?.mute?.();
  }
}

function currentPlayer(event) {
  return player && (!event?.target || event.target === player);
}

function onState(event) {
  if (!currentPlayer(event)) return;
  const playing = window.YT?.PlayerState?.PLAYING;
  const ended = window.YT?.PlayerState?.ENDED;
  if (event.data === playing) $("poster").style.opacity = "0";
  if (event.data === ended && mode !== "paused" && mode !== "stopped") advance("end");
}

function onError(event) {
  if (mode === "stopped" || !currentPlayer(event)) return;
  const code = event?.data;
  if (code === 2 || code === 5 || code === 100 || code === 101 || code === 150 || code === 153) advance("error");
}

async function loadCurrent(force) {
  if (mode === "stopped" || brokenHold) return;
  const spot = spotAt(playlist(), position());
  if (!spot) {
    showCard("NO TAPE");
    updateChrome(null);
    return;
  }
  updateChrome(spot);
  const key = `${channelId}:${broadcastCache?.day || dayKey(Date.now())}:${spot.index}`;
  if (spot.item.kind === "ident") {
    if (key === loadedKey && !force) return;
    loadedKey = key;
    showIdent(spot.item);
    return;
  }
  const same = key === loadedKey;
  if (same && !force) {
    syncDrift(spot);
    return;
  }
  if (same && force && playerKind === "youtube" && typeof player?.seekTo === "function") {
    ignoreUntil = Date.now() + 1500;
    player.seekTo(Math.max(0, spot.offset), true);
    if (mode === "paused") player.pauseVideo();
    else player.playVideo?.();
    return;
  }

  loadedKey = key;
  noteImpression(spot.item);
  const gen = ++loadGen;
  ignoreUntil = Date.now() + 4000;
  hideCard();
  showPoster(spot.item);
  document.title = `${spot.item.title} · Plebflix TV`;
  const start = Math.max(0, Math.floor(spot.offset));

  if (spot.item.source === "vimeo" || spot.item.source === "archive.org") {
    playIframe(spot.item, spot.offset);
    return;
  }
  if (spot.item.source !== "youtube") {
    destroyYoutube();
    hideEmbed();
    playSwf(spot.item, gen);
    return;
  }

  destroySwf();
  hideEmbed();
  try {
    await loadApi();
  } catch {
    return;
  }
  if (gen !== loadGen || mode === "stopped") return;
  const mount = ensureYtDiv();
  if (player && typeof player.loadVideoById === "function") {
    player.loadVideoById({ videoId: spot.item.embedId, startSeconds: start });
    if (soundOn) {
      player.unMute?.();
      player.setVolume?.(100);
    } else {
      player.mute?.();
    }
    if (mode === "paused") setTimeout(() => mode === "paused" && player?.pauseVideo?.(), 250);
    return;
  }
  playerKind = "youtube";
  player = new window.YT.Player(mount, {
    host: "https://www.youtube-nocookie.com",
    width: "100%",
    height: "100%",
    videoId: spot.item.embedId,
    playerVars: {
      autoplay: 1,
      mute: soundOn ? 0 : 1,
      start,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
      origin: location.origin,
    },
    events: { onReady, onError, onStateChange: onState },
  });
}

function syncDrift(spot) {
  if (playerKind !== "youtube" || typeof player?.getCurrentTime !== "function") return;
  if (mode === "paused" || mode === "stopped" || Date.now() < ignoreUntil) return;
  const state = player.getPlayerState?.();
  if (state === 2 || state === 5 || state === -1) player.playVideo?.();
  const time = player.getCurrentTime();
  if (Number.isFinite(time) && Math.abs(time - spot.offset) > 3) {
    player.seekTo(spot.offset, true);
    ignoreUntil = Date.now() + 2000;
  }
}

function advance(reason) {
  const items = playlist();
  if (items.length < 2) {
    showCard("SIGNAL LOST");
    return;
  }
  if (reason === "error") {
    streak += 1;
    hideCard();
    if (streak >= items.length) {
      brokenHold = true;
      loadedKey = "";
      showCard("SIGNAL LOST");
      snow.classList.add("on");
      setTimeout(() => {
        brokenHold = false;
        streak = 0;
        if (mode !== "stopped") {
          snow.classList.remove("on");
          hideCard();
          loadCurrent(true);
        }
      }, 8000);
      return;
    }
  }
  const spot = spotAt(items, mode === "paused" ? pausePos : position());
  if (!spot) return;
  const next = (spot.index + 1) % items.length;
  let start = 0;
  for (let i = 0; i < next; i += 1) start += items[i].duration;
  if (mode === "paused") pausePos = start;
  else setTimeshift(start);
  glitch();
  loadCurrent(true);
}

function nudge(delta) {
  const items = playlist();
  const total = totalDuration(items);
  if (!total) return;
  const base = mode === "paused" ? pausePos : mode === "timeshift" ? position() : liveSeconds(items, Date.now());
  const next = ((base + delta) % total + total) % total;
  hideCard();
  if (mode === "paused") pausePos = next;
  else setTimeshift(next);
  glitch();
  loadCurrent(true);
}

function stopSeek(event) {
  seekingDir = 0;
  if (seekTimer) {
    clearInterval(seekTimer);
    seekTimer = 0;
  }
  const button = event?.currentTarget;
  if (button && event.pointerId != null && button.hasPointerCapture?.(event.pointerId)) {
    button.releasePointerCapture(event.pointerId);
  }
}

function bindSeek(id, dir) {
  const button = $(id);
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    seekingDir = dir;
    seekStep = 15;
    nudge(dir * seekStep);
    clearInterval(seekTimer);
    seekTimer = setInterval(() => {
      seekStep = Math.min(45, seekStep + 5);
      nudge(dir * seekStep);
    }, 180);
  });
  button.addEventListener("pointerup", stopSeek);
  button.addEventListener("pointercancel", stopSeek);
}

function noteImpression(item) {
  if (!item || item.kind === "ident") return;
  const stamp = `${dayKey(Date.now())}:${channelId}:${item.id}`;
  if (impressed.has(stamp)) return;
  impressed.add(stamp);
  fetch("/api/impression", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: item.id, channel: channelId, viewerId: viewerId() }),
  }).catch(() => {});
}

let voteTimer = 0;
function flashVote(text) {
  const node = $("osd-vote");
  if (!node) return;
  node.hidden = false;
  node.textContent = text;
  clearTimeout(voteTimer);
  voteTimer = setTimeout(() => {
    node.hidden = true;
  }, 2200);
}

async function castVote(direction) {
  const spot = mode === "stopped" ? null : spotAt(playlist(), position());
  const item = spot?.item;
  if (!item || item.kind === "ident") {
    flashVote("NOT A TAPE");
    return;
  }
  const votes = savedVotes();
  if (votes[item.id]) {
    flashVote("ALREADY VOTED");
    return;
  }
  votes[item.id] = direction;
  try {
    localStorage.setItem("plebflix-votes", JSON.stringify(votes));
  } catch {
    /* private mode still sends the vote */
  }
  flashVote(direction === "up" ? "UP ▲" : "DOWN ▼");
  try {
    const response = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: item.id,
        channel: channelId,
        vote: direction,
        viewerId: viewerId(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) flashVote("ALREADY VOTED");
    else if (!response.ok) {
      delete votes[item.id];
      try {
        localStorage.setItem("plebflix-votes", JSON.stringify(votes));
      } catch {
        /* ignore */
      }
      flashVote(body.error || "VOTE FAILED");
    }
  } catch {
    delete votes[item.id];
    try {
      localStorage.setItem("plebflix-votes", JSON.stringify(votes));
    } catch {
      /* ignore */
    }
    flashVote("VOTE FAILED");
  }
}

function onPlay() {
  unlockSound();
  if (mode === "stopped") {
    goLive();
    snow.classList.remove("on");
    hideCard();
    glitch();
    loadCurrent(true);
    return;
  }
  if (mode === "paused") {
    const items = playlist();
    const total = totalDuration(items);
    const delta = total ? Math.abs(shiftFromLive(pausePos, liveSeconds(items, Date.now()), total)) : 0;
    if (delta <= 2) goLive();
    else setTimeshift(pausePos);
    player?.playVideo?.();
    loadCurrent(true);
    return;
  }
  if (mode === "timeshift") {
    goLive();
    glitch();
    loadCurrent(true);
    return;
  }
  player?.playVideo?.();
  loadCurrent(false);
}

function onPause() {
  if (mode === "stopped") return;
  pausePos = position();
  mode = "paused";
  player?.pauseVideo?.();
  updateChrome(spotAt(playlist(), pausePos));
}

function onStop() {
  mode = "stopped";
  loadedKey = "";
  loadGen += 1;
  destroyYoutube();
  hideEmbed();
  destroySwf();
  $("poster").hidden = true;
  showCard("NO SIGNAL");
  snow.classList.add("on");
  updateChrome(null);
}

function setChannel(id) {
  if (!channels.has(id) || id === channelId) return;
  channelId = id;
  try {
    localStorage.setItem(CHANNEL_KEY, id);
  } catch {
    /* ignore */
  }
  const select = document.querySelector("#rec-form select[name=channel]");
  if (select) select.value = id;
  if (mode === "stopped") {
    updateChrome(null);
    return;
  }
  goLive();
  glitch();
  loadCurrent(true);
}

function stepChannel(delta) {
  const ids = ORDER.filter((id) => channels.has(id));
  const index = ids.indexOf(channelId);
  setChannel(ids[(index + delta + ids.length) % ids.length]);
}

function tick() {
  $("osd-clock").textContent = clock();
  $("lcd-clock").textContent = clock();
  if (mode === "stopped" || brokenHold) {
    updateChrome(mode === "stopped" ? null : spotAt(playlist(), position()));
    return;
  }
  const items = playlist();
  if (!items.length) {
    showCard("NO TAPE");
    updateChrome(null);
    return;
  }
  const spot = spotAt(items, position());
  const key = `${channelId}:${broadcastCache?.day || dayKey(Date.now())}:${spot.index}`;
  if (key !== loadedKey) loadCurrent(false);
  else {
    updateChrome(spot);
    syncDrift(spot);
  }
}

function wire() {
  $("btn-up").addEventListener("click", () => castVote("up"));
  $("btn-down").addEventListener("click", () => castVote("down"));
  $("btn-play").addEventListener("click", onPlay);
  $("btn-pause").addEventListener("click", onPause);
  $("btn-stop").addEventListener("click", onStop);
  $("btn-ch-down").addEventListener("click", () => stepChannel(-1));
  $("btn-ch-up").addEventListener("click", () => stepChannel(1));
  bindSeek("btn-rew", -1);
  bindSeek("btn-fwd", 1);
  for (const tape of document.querySelectorAll(".tape")) {
    tape.addEventListener("click", () => setChannel(tape.dataset.channel));
  }
  $("live-pill").addEventListener("click", () => {
    const stopped = mode === "stopped";
    goLive();
    if (stopped) {
      snow.classList.remove("on");
      hideCard();
    }
    glitch();
    loadCurrent(true);
  });

  const dialog = $("rec-dialog");
  const form = $("rec-form");
  const status = $("form-status");
  $("btn-rec").addEventListener("click", () => {
    status.textContent = "";
    const select = form.querySelector("select[name=channel]");
    if (select) select.value = channelId;
    dialog.showModal();
    $("btn-rec").setAttribute("aria-pressed", "true");
    updateChrome(mode === "stopped" ? null : spotAt(playlist(), position()));
  });
  $("rec-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    $("btn-rec").setAttribute("aria-pressed", "false");
  });
  const yearInput = form.querySelector("input[name=year]");
  if (yearInput) yearInput.max = String(new Date().getUTCFullYear() - 10);
  $("sound-hint").addEventListener("click", unlockSound);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const signals = [...form.querySelectorAll("input[name=signal]:checked")].map((box) => box.value);
    const cutoff = new Date().getUTCFullYear() - 10;
    const year = Number(data.year);
    if (!Number.isInteger(year) || year < 1970 || year > cutoff) {
      status.textContent = `The year has to be ${cutoff} or earlier.`;
      return;
    }
    if (signals.length < 3) {
      status.textContent = "Pick at least three signals.";
      return;
    }
    const submit = $("rec-submit");
    submit.disabled = true;
    status.textContent = "Filing…";
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: data.url,
          channel: data.channel,
          title: data.title,
          year,
          why: data.why,
          signals,
          note: data.note,
          company: data.company,
        }),
      });
      const body = await response.json();
      status.textContent = "";
      if (typeof body.prUrl === "string" && body.prUrl.startsWith("https://github.com/")) {
        status.append(body.message || "Filed. ");
        status.append(" ");
        const link = document.createElement("a");
        link.href = body.prUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = body.prUrl;
        status.append(link);
      } else if (body.ok) {
        status.textContent = body.message || "Filed.";
      } else {
        status.textContent = body.error || "The deck jammed.";
      }
    } catch {
      status.textContent = "The deck jammed before it reached the shelf.";
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === " ") {
      event.preventDefault();
      if (mode === "live" || mode === "timeshift") onPause();
      else onPlay();
    } else if (event.key === "ArrowLeft") nudge(-15);
    else if (event.key === "ArrowRight") nudge(15);
    else if (event.key === "ArrowUp") stepChannel(1);
    else if (event.key === "ArrowDown") stepChannel(-1);
    else if (event.key === "s" || event.key === "S") onStop();
    else if (event.key === "r" || event.key === "R") $("btn-rec").click();
  });

  if (!reduceMotion && !snowTimer) snowTimer = setInterval(drawSnow, 80);
}

async function boot() {
  try {
    const [suomi, international] = await Promise.all([
      fetch("/channels/suomi.json").then((response) => response.json()),
      fetch("/channels/international.json").then((response) => response.json()),
    ]);
    channels.set("suomi", suomi);
    channels.set("international", international);
  } catch {
    showCard("NO TAPE");
    return;
  }
  try {
    const saved = localStorage.getItem(CHANNEL_KEY);
    if (channels.has(saved)) channelId = saved;
  } catch {
    channelId = "suomi";
  }
  let acceptStats = true;
  const pullStats = Promise.all(
    ORDER.map(async (id) => {
      try {
        const response = await fetch(`/api/stats?channel=${id}&day=${dayKey(Date.now())}`);
        if (!response.ok || !acceptStats) return;
        const body = await response.json();
        if (acceptStats && body?.items && typeof body.items === "object" && !Array.isArray(body.items)) {
          statsMap[id] = body.items;
        }
      } catch {
        /* the day still airs, unweighted */
      }
    }),
  );
  await Promise.race([pullStats, new Promise((resolve) => setTimeout(resolve, 1500))]);
  acceptStats = false;
  broadcastCache = null;
  wire();
  glitch();
  tick();
  setInterval(tick, 250);
}

boot();

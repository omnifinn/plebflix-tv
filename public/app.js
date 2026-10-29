import { buildBroadcast, dayKey, liveSeconds, spotAt, shiftFromLive, totalDuration } from "./schedule.js";

/* Plebflix TV — PLEBAMP skin (design: Iris). Rocker order follows the design: International, then Suomi. */
let ORDER = ["international", "suomi"];
const LANGS = ["international", "suomi"];
const SHORT = { international: "INTL", suomi: "SUOMI" };
/** Channel × language: channel ids are "<lang>" (CH 1, all tapes) or "<lang>-<category>". */
const META = new Map();
const langOf = (id = channelId) => META.get(id)?.lang || (LANGS.includes(id) ? id : String(id).split("-")[0]) || "international";
/** Votes and impressions always count against a tape's language. */
const homeOf = (item, id = channelId) => item?.home || langOf(id);
function statsFor(map, id) {
  return map[langOf(id)] || {};
}
const CHANNEL_KEY = "plebflix-channel";
const SOUND_KEY = "plebflix-sound";

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobileQuery = window.matchMedia("(max-width: 719px)");

const channels = new Map();
const statsMap = {};
const impressed = new Set();
/** Votes this viewer cast after the stats snapshot was taken, so the tally moves at once. */
const freshVotes = {};
let broadcastCache = null;
let channelId = "international";
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
let shelfHosts = [];
let lastMarquee = "";
let lastSchedKey = "";
let lastAnnounce = "";
/** On load the deck goes straight to LIVE: the shared wall-clock broadcast. (No intro clip.) */
const INTRO = { kind: "intro", id: "none", title: "", year: 0, duration: 1, media: "" };
let introActive = false;
/** Playback mode, cycled by the mode key: live (synced broadcast) → loop (this tape) → shuffle (no repeats). */
const PLAY_MODES = ["live", "loop", "shuffle"];
const MODE_KEY = "plebflix-mode";
let playMode = "live";
let lastClip = null; // { index, start, duration, id } of the clip that was on at the previous tick
let userSeeked = false;
let shuffleQueue = [];
const shuffleHistory = [];
const topStats = {};
const brokenMedia = new Set();
/** True while the deck is on the post-intro shuffle run (top tape, then onward). */
let shuffleRun = false;

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

function playlist(id = channelId) {
  const channel = channels.get(id);
  if (!channel) return [];
  const day = dayKey(Date.now());
  const stats = statsFor(statsMap, id);
  const sig = JSON.stringify(stats);
  if (!broadcastCache || broadcastCache.id !== id || broadcastCache.day !== day || broadcastCache.sig !== sig) {
    broadcastCache = {
      id,
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
  shuffleRun = false;
  lastClip = null;
  mode = "live";
  brokenHold = false;
  streak = 0;
}

const pad = (n) => String(n).padStart(2, "0");

function clock(withSeconds = true) {
  const now = new Date();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return withSeconds ? `${hm}:${pad(now.getSeconds())}` : hm;
}

function hhmm(epochMs) {
  const at = new Date(epochMs);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** m:ss — schedule durations, vote/timeshift offsets. */
function fmt(seconds) {
  const abs = Math.abs(Math.round(seconds));
  return `${Math.floor(abs / 60)}:${pad(abs % 60)}`;
}

/** mm:ss — LCD timecode. */
function tc(seconds) {
  const abs = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function channelNumber(id = channelId) {
  return pad(channels.get(id)?.number || (id === "suomi" ? 1 : 2));
}

/** Label for the SOURCE pill: host of original_url; Wayback links show the archived host and snapshot year. */
export function sourceLabel(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "web.archive.org") {
    const match = url.pathname.match(/^\/web\/(\d{4})\d*[a-z_]*\/(?:https?:\/\/)?([^/:]+)/i);
    if (match) return `${match[2].replace(/^www\./, "")} (Wayback, ${match[1]})`;
    return "web.archive.org (Wayback)";
  }
  return host;
}

function setLamps(state, text) {
  for (const lamp of $$(".lamp")) {
    lamp.dataset.state = state;
    if (lamp.textContent !== text) lamp.textContent = text;
  }
  const live = $("btn-live");
  if (live) {
    const on = state === "live";
    live.dataset.state = state;
    live.setAttribute("aria-pressed", String(on));
    const label = on ? "● LIVE" : "▶ GO LIVE";
    if (live.textContent !== label) live.textContent = label;
  }
}

function setMarquee(text) {
  if (text === lastMarquee) return;
  lastMarquee = text;
  const marquee = $("marquee");
  const track = marquee.querySelector(".marquee__track");
  for (const span of track.children) span.textContent = text;
  sizeMarquee();
}

function sizeMarquee() {
  const marquee = $("marquee");
  const track = marquee.querySelector(".marquee__track");
  const first = track.firstElementChild;
  marquee.classList.remove("marquee--static");
  const overflow = first.scrollWidth > marquee.clientWidth;
  marquee.classList.toggle("marquee--static", !overflow);
  track.style.setProperty("--marquee-dur", `${(first.scrollWidth / 40).toFixed(1)}s`);
}

function tally(item) {
  if (!item || item.kind === "ident") return null;
  const stats = statsFor(statsMap, channelId)?.[item.id] || {};
  const fresh = freshVotes[`${channelId}:${item.id}`];
  return {
    up: (Number(stats.up) || 0) + (fresh === "up" ? 1 : 0),
    down: (Number(stats.down) || 0) + (fresh === "down" ? 1 : 0),
  };
}

function updateChrome(spot) {
  const channel = channels.get(channelId);
  const number = channelNumber();
  const short = SHORT[channelId] || "";
  const item = mode === "stopped" ? null : spot?.item || null;
  const isClip = Boolean(item && item.kind !== "ident");
  const items = playlist();
  const total = totalDuration(items);
  const here = mode === "stopped" ? 0 : position();
  const delta = total ? shiftFromLive(here, liveSeconds(items, Date.now()), total) : 0;

  document.body.dataset.channel = langOf();
  $("osd-ch").textContent = `CH ${number}`;
  $("lcd-ch").textContent = `CH ${number} ${short}`;
  $("lcd-clock").textContent = clock();
  $("lcd-year").textContent = isClip && item.year ? String(item.year) : "----";

  // marquee + screen-reader twin
  let line;
  if (mode === "stopped") line = "NO SIGNAL ★ PRESS PLAY ★ PLEBFLIX — REAL HUMAN SLOP ★";
  else if (!item) line = "NO TAPE ★ PLEBFLIX — REAL HUMAN SLOP ★";
  else if (!isClip) {
    const next = upcomingClip(items, spot.index);
    line = `PLEBFLIX — REAL HUMAN SLOP ★ CH ${number} ${(channel?.name || "").toUpperCase()} ★${next ? ` UP NEXT: ${next.title.toUpperCase()} ★` : ""}`;
  } else line = `${item.title} ★ ${item.year} ★ ${modeWord()} ★`.toUpperCase();
  setMarquee(line);
  const announce = isClip ? `Now playing: ${item.title}, ${item.year}` : mode === "stopped" ? "Stopped" : "Station ident";
  if (announce !== lastAnnounce) {
    lastAnnounce = announce;
    $("announce").textContent = announce;
  }

  // progress + timecode
  const offset = spot ? Math.max(0, spot.offset) : 0;
  const dur = item?.duration || 0;
  const pct = dur ? Math.min(100, (offset / dur) * 100) : 0;
  if (!scrubbing) {
    $("scrub").style.setProperty("--p", `${pct.toFixed(2)}%`);
    $("scrub").setAttribute("aria-valuenow", pct.toFixed(0));
    $("scrub").setAttribute("aria-valuetext", `${tc(dur ? offset : 0)} of ${tc(dur)}`);
  }
  $("lcd-tc").textContent = `${tc(dur ? offset : 0)} / ${tc(dur)}`;

  // lamps
  if (mode === "stopped") setLamps("stopped", "STOP");
  else if (mode === "live" && !seekingDir) setLamps("live", "LIVE");
  else if (mode === "paused" && Math.abs(delta) < 2) setLamps("timeshift", "PAUSE");
  else if (mode === "timeshift" && playMode !== "live") setLamps("timeshift", playMode.toUpperCase());
  else setLamps("timeshift", `TIMESHIFT ${delta >= 0 ? "+" : "−"}${tc(delta < 0 ? -delta : delta)}`);

  paintMode();
  // transport latches: exactly one mode key
  const latched = seekingDir < 0 ? "rew" : seekingDir > 0 ? "fwd" : mode === "paused" ? "pause" : mode === "stopped" ? "stop" : "play";
  $("btn-rew").setAttribute("aria-pressed", String(latched === "rew"));
  $("btn-fwd").setAttribute("aria-pressed", String(latched === "fwd"));
  $("btn-play").setAttribute("aria-pressed", String(latched === "play"));
  $("btn-stop").setAttribute("aria-pressed", String(latched === "stop"));
  const pause = $("btn-pause");
  if (mobileQuery.matches) {
    // mobile: PAUSE doubles as PLAY, lit while playing
    const playing = mode === "live" || mode === "timeshift";
    pause.setAttribute("aria-pressed", String(playing));
    pause.setAttribute("aria-label", playing ? "Pause" : "Play");
    pause.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
    pause.querySelector("span").textContent = playing ? "Pause" : "Play";
  } else {
    pause.setAttribute("aria-pressed", String(latched === "pause"));
    pause.setAttribute("aria-label", "Pause");
    pause.querySelector("use").setAttribute("href", "#i-pause");
    pause.querySelector("span").textContent = "Pause";
  }
  $("btn-rec").setAttribute("aria-pressed", String($("rec-dialog").open));
  if ($("eq")) $("eq").dataset.state = mode === "paused" || mode === "stopped" || !isClip ? "flat" : "live";

  // votes
  const vote = isClip ? savedVotes()[item.id] : "";
  $("btn-up").setAttribute("aria-pressed", vote === "up" ? "true" : "false");
  $("btn-down").setAttribute("aria-pressed", vote === "down" ? "true" : "false");
  const counts = tally(item);
  $("tally-up").textContent = counts ? String(counts.up) : "-";
  $("tally-down").textContent = counts ? String(counts.down) : "-";
  $("tally").setAttribute("aria-label", counts ? `${counts.up} up, ${counts.down} down` : "Nothing to vote on");

  $("sound-hint").hidden = soundOn || mode === "stopped";

  // SOURCE pill → the tape's original_url
  const source = $("source");
  const url = isClip ? item.original_url : "";
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    source.href = url;
    source.removeAttribute("aria-disabled");
    source.removeAttribute("tabindex");
    $("source-host").textContent = sourceLabel(url);
  } else {
    source.href = "/RESOURCES.md";
    source.setAttribute("aria-disabled", "true");
    source.setAttribute("tabindex", "-1");
    $("source-host").textContent = mode === "stopped" ? "no signal" : "station ident";
  }

  renderSchedule(spot);
}

function modeWord() {
  if (seekingDir < 0) return "REW";
  if (seekingDir > 0) return "FWD";
  if (mode === "paused") return "PAUSED";
  if (mode === "timeshift") return playMode === "loop" ? "LOOP" : playMode === "shuffle" ? "SHUFFLE" : "TIMESHIFT";
  return "NOW PLAYING";
}

function upcomingClip(items, index) {
  for (let step = 1; step <= items.length; step += 1) {
    const candidate = items[(index + step) % items.length];
    if (candidate.kind !== "ident") return candidate;
  }
  return null;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Schedule window: last clip, the one on now, and what airs next, at real local wall-clock times. */
function renderSchedule(spot) {
  const channel = channels.get(channelId);
  const items = playlist();
  const list = $("sched");
  $("sched-ch").textContent = `CH ${channelNumber()} ${channel?.name || ""}`;
  $("sched-tagline").textContent = channel?.tagline || "";
  const count = (channel?.items || []).filter((item) => item.status !== "pending" && item.duration > 0).length;
  $("sched-foot").textContent = `${count} TAPES · LIVE LOOP · ALL TIMES LOCAL`;

  if (!items.length || !spot || mode === "stopped") {
    const key = `${channelId}:empty:${mode}`;
    if (key !== lastSchedKey) {
      lastSchedKey = key;
      list.innerHTML = `<li class="sched__empty">${mode === "stopped" ? "NO SIGNAL — PRESS PLAY" : "NO TAPE"}</li>`;
      $("peek").textContent = "—";
    }
    return;
  }
  const now = Date.now();
  const total = totalDuration(items);
  const key = `${channelId}:${broadcastCache?.day}:${spot.index}:${Math.floor((now - spot.offset * 1000) / 60000)}`;
  if (key !== lastSchedKey) {
    lastSchedKey = key;
    // epoch ms at which a playlist offset airs, as seen from this viewer's current position
    const base = now - spot.offset * 1000;
    const rows = [];
    // one past clip
    for (let back = 1, at = spot.start; back < items.length && rows.length < 1; back += 1) {
      const index = (spot.index - back + items.length) % items.length;
      at -= items[index].duration;
      if (items[index].kind !== "ident") rows.push({ item: items[index], when: base + (at - spot.start) * 1000, state: "past", at });
    }
    if (spot.item.kind !== "ident") rows.push({ item: spot.item, when: base, state: "now", at: spot.start });
    let at = spot.start + spot.item.duration;
    for (let step = 1; step < items.length && rows.length < 16; step += 1) {
      const item = items[(spot.index + step) % items.length];
      if (item.kind !== "ident") rows.push({ item, when: base + (at - spot.start) * 1000, state: "", at });
      at += item.duration;
      if (at - spot.start > total) break;
    }
    const lang = channelId === "suomi" ? ' lang="fi"' : "";
    list.innerHTML = rows
      .map(
        ({ item, when, state, at }) =>
          `<li class="sched__row${state ? ` sched__row--${state}` : ""}" data-at="${at}" tabindex="0" role="button" title="Play ${escapeHtml(item.title)}"${state === "now" ? ' aria-current="true"' : ""}>` +
          `<span class="sched__time">${hhmm(when)}</span><span class="sched__title"${lang}>${escapeHtml(item.title)}</span>` +
          `<span class="sched__year">${escapeHtml(item.year ?? "")}</span><span class="sched__dur">${fmt(item.duration)}</span></li>`,
      )
      .join("");
    const next = rows.find((row) => !row.state);
    $("peek").textContent = next ? `${hhmm(next.when)}  ${next.item.title}  ${next.item.year ?? ""}` : "—";
    if (lang) $("peek").setAttribute("lang", "fi");
    else $("peek").removeAttribute("lang");
  }
  const nowRow = list.querySelector(".sched__row--now");
  if (nowRow && spot.item.duration) nowRow.style.setProperty("--p", `${Math.min(100, (spot.offset / spot.item.duration) * 100).toFixed(1)}%`);
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
  stopVideo();
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
  if (item.poster) {
    poster.onerror = null;
    poster.src = item.poster;
  } else if (item.source === "youtube") {
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
    poster.hidden = true;
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
  if (playerKind === "video" && vid) {
    vid.muted = false;
    vid.volume = 1;
    if (introActive) vid.currentTime = 0; // hear the llama from the top
    if (vid.paused && mode !== "paused" && mode !== "stopped") vid.play().catch(() => {});
  }
  if (player && typeof player.unMute === "function") {
    player.unMute();
    player.setVolume(100);
  }
  const frame = $("embed");
  if (playerKind === "iframe" && frame?.contentWindow) {
    frame.contentWindow.postMessage(JSON.stringify({ method: "setVolume", value: 1 }), "*");
  }
}

const vid = $("vid");

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
    vid.hidden = true;
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
  if (introActive) {
    // Any deck key during the intro skips it.
    introActive = false;
    stopVideo();
  }
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
  if (same && force && playerKind === "video" && vid?.getAttribute("src")) {
    try {
      vid.currentTime = Math.max(0, spot.offset);
    } catch {
      /* ignore */
    }
    if (mode === "paused") vid.pause();
    else vid.play().catch(() => {});
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
  announceTape(spot.item);
  const gen = ++loadGen;
  ignoreUntil = Date.now() + 4000;
  hideCard();
  showPoster(spot.item);
  document.title = `${spot.item.title} · Plebflix TV`;
  const start = Math.max(0, Math.floor(spot.offset));

  if (spot.item.media && !brokenMedia.has(spot.item.media)) {
    playVideo(spot.item, spot.offset, gen);
    return;
  }
  stopVideo();
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
  if (playerKind === "video" && vid && !vid.hidden) {
    if (mode === "paused" || mode === "stopped" || Date.now() < ignoreUntil) return;
    if (vid.paused && !vid.ended && vid.readyState >= 2) vid.play().catch(() => {});
    if (vid.readyState >= 1 && Math.abs(vid.currentTime - spot.offset) > 4) {
      try {
        vid.currentTime = spot.offset;
      } catch {
        /* ignore */
      }
      ignoreUntil = Date.now() + 2000;
    }
    return;
  }
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
  shuffleRun = false;
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

// Plays are queued and sent in one small batch (every 6 tapes, after 90 s, or when the tab hides),
// so a long watch costs a handful of Worker requests instead of one per tape.
const playQueue = [];
let playTimer = 0;
function flushPlays(beacon = false) {
  clearTimeout(playTimer);
  playTimer = 0;
  if (!playQueue.length) return;
  const body = JSON.stringify({ viewerId: viewerId(), plays: playQueue.splice(0, 20) });
  if (beacon && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon("/api/impression", new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall back to fetch */
    }
  }
  fetch("/api/impression", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPlays(true);
});
addEventListener("pagehide", () => flushPlays(true));

function noteImpression(item) {
  if (!item || item.kind === "ident") return;
  const stamp = `${dayKey(Date.now())}:${homeOf(item)}:${item.id}`;
  if (impressed.has(stamp)) return;
  impressed.add(stamp);
  playQueue.push({ itemId: item.id, channel: homeOf(item) });
  if (playQueue.length >= 6) flushPlays();
  else if (!playTimer) playTimer = setTimeout(() => flushPlays(), 90000);
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

function storeVotes(votes) {
  try {
    localStorage.setItem("plebflix-votes", JSON.stringify(votes));
  } catch {
    /* private mode still sends the vote */
  }
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
  const voteChannel = channelId;
  const freshKey = `${voteChannel}:${item.id}`;
  votes[item.id] = direction;
  storeVotes(votes);
  freshVotes[freshKey] = direction;
  flashVote(direction === "up" ? "UP ▲" : "DOWN ▼");
  updateChrome(spot);
  const undo = (message) => {
    const current = savedVotes();
    delete current[item.id];
    storeVotes(current);
    delete freshVotes[freshKey];
    flashVote(message);
    updateChrome(mode === "stopped" ? null : spotAt(playlist(), position()));
  };
  try {
    const response = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: item.id,
        channel: homeOf(item, voteChannel),
        vote: direction,
        viewerId: viewerId(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) {
      delete freshVotes[freshKey];
      flashVote("ALREADY VOTED");
    } else if (!response.ok) undo(String(body.error || "VOTE FAILED").toUpperCase().slice(0, 40));
  } catch {
    undo("VOTE FAILED");
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
    if (playerKind === "video") vid.play().catch(() => {});
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
  if (introActive) finishIntro();
  pausePos = position();
  mode = "paused";
  player?.pauseVideo?.();
  if (playerKind === "video") vid.pause();
  updateChrome(spotAt(playlist(), pausePos));
}

function onStop() {
  mode = "stopped";
  loadedKey = "";
  loadGen += 1;
  introActive = false;
  stopVideo();
  destroyYoutube();
  hideEmbed();
  destroySwf();
  $("poster").hidden = true;
  showCard("NO SIGNAL");
  snow.classList.add("on");
  document.title = "Plebflix TV — real human slop";
  updateChrome(null);
}

function backToLive() {
  const stopped = mode === "stopped";
  if (playMode !== "live") {
    playMode = "live";
    try {
      localStorage.setItem(MODE_KEY, "live");
    } catch {
      /* ignore */
    }
  }
  goLive();
  if (stopped) {
    snow.classList.remove("on");
    hideCard();
  }
  glitch();
  loadCurrent(true);
}

function tune() {
  if (reduceMotion) return;
  document.body.dataset.tuning = "";
  setTimeout(() => delete document.body.dataset.tuning, 260);
}

const TV_LABEL = { international: "INTERNATIONAL", suomi: "SUOMI" };
function idsFor(lang = langOf()) {
  return ORDER.filter((id) => channels.has(id) && langOf(id) === lang).sort((a, b) => (META.get(a)?.number || 0) - (META.get(b)?.number || 0));
}
/** The TV switch (International / Suomi) plus the channel selector for the TV that is on. */
function buildTuner() {
  const tuner = $("tuner");
  if (!tuner) return;
  const lang = langOf();
  const tv = $("tv-switch");
  tv.innerHTML = LANGS.map((l) => `<button type="button" class="tv__seg tv__seg--${l === "suomi" ? "suomi" : "intl"} key" role="radio" aria-checked="${l === lang}" data-lang="${l}"><span class="tv__lamp" aria-hidden="true"></span>${TV_LABEL[l]}</button>`).join("");
  const list = $("ch-list");
  list.innerHTML = idsFor(lang)
    .map((id) => {
      const m = META.get(id) || {};
      return `<button type="button" class="ch key" role="radio" aria-checked="false" data-ch="${id}" title="${escapeHtml(m.name || id)}${m.count ? ` · ${m.count} ${lang === "suomi" ? "nauhaa" : "tapes"}` : ""}"><span class="ch__num">${pad(m.number || 0)}</span><span class="ch__name">${escapeHtml(m.short || id)}</span></button>`;
    })
    .join("");
  $("ch-down").setAttribute("aria-label", lang === "suomi" ? "Edellinen kanava" : "Previous channel");
  $("ch-up").setAttribute("aria-label", lang === "suomi" ? "Seuraava kanava" : "Next channel");
}
function wireTuner() {
  $("tv-switch").addEventListener("click", (event) => {
    const seg = event.target.closest?.("[data-lang]");
    if (seg) setLang(seg.dataset.lang);
  });
  $("ch-list").addEventListener("click", (event) => {
    const seg = event.target.closest?.("[data-ch]");
    if (seg) setChannel(seg.dataset.ch);
  });
  $("ch-up").addEventListener("click", () => stepChannel(1));
  $("ch-down").addEventListener("click", () => stepChannel(-1));
  $("tuner").addEventListener("keydown", (event) => {
    if (!event.target.closest?.("#ch-list, #tv-switch")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest("#tv-switch")) {
      setLang(langOf() === "suomi" ? "international" : "suomi");
      $$("#tv-switch [data-lang]").find((seg) => seg.dataset.lang === langOf())?.focus();
    } else {
      stepChannel(event.key === "ArrowRight" ? 1 : -1);
      $$("#ch-list [data-ch]").find((seg) => seg.dataset.ch === channelId)?.focus();
    }
  });
}
/** Flip the TV: same category on the other language when it exists, else CH 1 there. */
function setLang(lang) {
  if (!LANGS.includes(lang) || lang === langOf()) return;
  const cat = META.get(channelId)?.cat;
  const same = cat && cat !== "all" ? `${lang}-${cat}` : lang;
  setChannel(channels.has(same) ? same : lang);
}

function applyChannelChrome() {
  const lang = langOf();
  lastClip = null;
  shuffleQueue = [];
  if ($("tuner") && $("tuner").dataset.lang !== lang) {
    buildTuner();
    $("tuner").dataset.lang = lang;
  }
  document.body.dataset.channel = lang;
  document.body.dataset.ch = channelId;
  document.documentElement.lang = lang === "suomi" ? "fi" : "en";
  for (const seg of $$("#ch-list [data-ch]")) {
    const on = seg.dataset.ch === channelId;
    seg.setAttribute("aria-checked", String(on));
    if (on) seg.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  for (const seg of $$("#tv-switch [data-lang]")) seg.setAttribute("aria-checked", String(seg.dataset.lang === lang));
  const m = META.get(channelId) || {};
  if ($("ch-now")) $("ch-now").textContent = `CH ${pad(m.number || 1)} · ${m.name || ""}`;
  document.body.dataset.kind = m.kind === "category" ? "category" : "lang";
  const icon = $("favicon-svg");
  if (icon) {
    // Keep whatever ?v= the share block was built with (share.config.json version).
    const v = new URL(icon.href, location.href).search;
    icon.href = (lang === "suomi" ? "/suomi/favicon.svg" : "/favicon.svg") + v;
  }
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = lang === "suomi" ? "#04080D" : "#0B0D10";
  lastSchedKey = "";
  lastMarquee = "";
}

function setChannel(id) {
  if (!channels.has(id) || id === channelId) return;
  channelId = id;
  try {
    localStorage.setItem(CHANNEL_KEY, id);
  } catch {
    /* ignore */
  }
  history.replaceState(null, "", `#${id}`);
  applyChannelChrome();
  tune();
  if (mode === "stopped") {
    updateChrome(null);
    return;
  }
  goLive();
  glitch();
  loadCurrent(true);
}

function stepChannel(delta) {
  const ids = idsFor();
  const index = ids.indexOf(channelId);
  setChannel(ids[(index + delta + ids.length) % ids.length]);
}

function shuffleIds(items) {
  const ids = [...new Set(items.filter((item) => item.kind !== "ident" && item.duration > 0).map((item) => item.id))];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
/** Start of the next airing of `id` at or after the current position. */
function occurrenceStart(items, id) {
  const total = totalDuration(items);
  const here = position();
  let at = 0;
  let best = null;
  for (const item of items) {
    if (item.id === id) {
      const ahead = (at - here + total) % total;
      if (best === null || ahead < best.ahead) best = { at, ahead };
    }
    at += item.duration;
  }
  return best ? best.at : null;
}
/** Next tape in the shuffle bag: random order, no repeats until every tape has played. */
function nextShuffleStart(items) {
  if (!shuffleQueue.length) {
    shuffleQueue = shuffleIds(items);
    if (lastClip && shuffleQueue.length > 1 && shuffleQueue[0] === lastClip.id) shuffleQueue.push(shuffleQueue.shift());
  }
  const id = shuffleQueue.shift();
  if (!id) return null;
  if (lastClip) shuffleHistory.push(lastClip.id);
  return occurrenceStart(items, id);
}
function paintMode() {
  const btn = $("btn-mode");
  const label = playMode.toUpperCase();
  const next = PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length].toUpperCase();
  if (btn) {
    btn.dataset.mode = playMode;
    btn.setAttribute("aria-label", `Playback mode: ${label}. Click for ${next}.`);
    btn.setAttribute("aria-pressed", String(playMode !== "live"));
    btn.querySelector(".mode__icon").textContent = playMode === "live" ? "((•))" : playMode === "loop" ? "⟲" : "⤨";
  }
  if ($("mode-label")) $("mode-label").textContent = label;
  if ($("lcd-mode")) $("lcd-mode").textContent = playMode === "live" && mode === "timeshift" ? "LIVE·TS" : label;
}
function cycleMode() {
  playMode = PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length];
  try {
    localStorage.setItem(MODE_KEY, playMode);
  } catch {
    /* ignore */
  }
  shuffleQueue = [];
  if (playMode === "live") {
    backToLive();
  } else if (playMode === "shuffle" && mode !== "stopped") {
    // start the bag now: jump to a random tape
    const items = playlist();
    const next = nextShuffleStart(items);
    if (next !== null) seekTo(next, { quiet: false });
  }
  paintMode();
  flashVote?.(`MODE: ${playMode.toUpperCase()}`);
}

function tick() {
  $("lcd-clock").textContent = clock();
  if (introActive) return;
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
  let spot = spotAt(items, position());
  if (lastClip && !userSeeked && mode !== "paused" && spot.index !== lastClip.index && playMode !== "live") {
    // the tape that was on just ended by itself
    if (playMode === "loop") {
      setTimeshift(lastClip.start);
      loadedKey = "";
    } else if (playMode === "shuffle") {
      const next = nextShuffleStart(items);
      if (next !== null) {
        setTimeshift(next);
        loadedKey = "";
      }
    }
    spot = spotAt(items, position());
  }
  userSeeked = false;
  if (spot.item.kind !== "ident") lastClip = { index: spot.index, start: spot.start, duration: spot.item.duration, id: spot.item.id };
  else if (playMode === "live") lastClip = null;
  const key = `${channelId}:${broadcastCache?.day || dayKey(Date.now())}:${spot.index}`;
  if (key !== loadedKey) loadCurrent(false);
  else {
    updateChrome(spot);
    syncDrift(spot);
  }
}

/* ── EQ (decorative, deterministic so it looks the same every load) ── */
function buildEq() {
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const shape = (i, n) => 0.55 + 0.35 * Math.sin((i / n) * Math.PI * 2.2 + 0.6) * (0.7 + 0.3 * rnd());
  if (!$("eq")) return;
  $("eq").innerHTML = Array.from({ length: 28 }, (_, i) => {
    const h = Math.min(0.98, Math.max(0.45, shape(i, 28) + 0.15)).toFixed(2);
    return `<i class="eq__col" style="--h:${h};--d:${(0.6 + rnd() * 0.8).toFixed(2)}s;--dl:-${(rnd() * 1.4).toFixed(2)}s"><b class="eq__bar"><b class="eq__fill"></b></b><b class="eq__peak"></b></i>`;
  }).join("");

}

/* ── REC dialog ── */
const EMBED_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "vimeo.com", "www.vimeo.com", "player.vimeo.com"];

function hostVerdict(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ok =
    url.protocol === "https:" &&
    (EMBED_HOSTS.includes(host) || shelfHosts.some(({ name, subdomains }) => host === name || (subdomains && host.endsWith(`.${name}`))));
  return { host, ok };
}

function setRecStatus(text, state = "") {
  const status = $("form-status");
  status.textContent = text;
  status.parentElement.dataset.state = state;
}

function wireRec() {
  const dialog = $("rec-dialog");
  const form = $("rec-form");
  const submit = $("rec-submit");
  const urlInput = form.querySelector("input[name=url]");
  const echo = $("host-echo");
  const signals = $$("input[name=signal]", form);
  const radios = $$("input[name=channel]", form);
  const yearInput = form.querySelector("input[name=year]");
  const cutoff = () => new Date().getUTCFullYear() - 10;
  if (yearInput) yearInput.max = String(cutoff());

  const syncSignals = () => {
    const n = signals.filter((box) => box.checked).length;
    $("sig-count").textContent = `${n}/3`;
    submit.disabled = submit.dataset.busy === "1";
  };
  const syncRadios = () => {
    for (const label of $$(".rocker--block .rocker__seg", form)) {
      label.setAttribute("aria-checked", String(Boolean(label.querySelector("input:checked"))));
    }
  };
  const syncEcho = () => {
    const value = urlInput.value.trim();
    const verdict = value ? hostVerdict(value) : null;
    if (!value) {
      echo.textContent = "HOST · —";
      delete echo.dataset.ok;
      return;
    }
    echo.textContent = "";
    echo.append(`HOST · ${verdict?.host || "?"} `);
    const badge = document.createElement("b");
    badge.textContent = verdict?.ok ? "✓ KNOWN SHELF" : verdict ? "✓ WE'LL TRY TO ARCHIVE IT" : "NOT A LINK";
    echo.append(badge);
    echo.dataset.ok = String(Boolean(verdict?.ok));
  };

  signals.forEach((box) => box.addEventListener("change", syncSignals));
  radios.forEach((radio) => radio.addEventListener("change", syncRadios));
  urlInput.addEventListener("input", syncEcho);

  const open = () => {
    for (const radio of radios) radio.checked = radio.value === channelId;
    syncRadios();
    syncSignals();
    syncEcho();
    setRecStatus("INSERT TAPE · PASTE A LINK TO A 10+ YEAR OLD CLASSIC");
    dialog.showModal();
    $("btn-rec").setAttribute("aria-pressed", "true");
  };
  $("btn-rec").addEventListener("click", open);
  $("rec-cancel").addEventListener("click", () => dialog.close());
  $("rec-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    $("btn-rec").setAttribute("aria-pressed", "false");
    $("btn-rec").focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const picked = signals.filter((box) => box.checked).map((box) => box.value);
    const year = Number(data.year);
    const verdict = hostVerdict(data.url || "");
    if (!verdict) return setRecStatus("THAT LINK WON'T PLAY · USE A FULL https:// URL", "error");
    if (!Number.isInteger(year) || year < 1970 || year > cutoff()) return setRecStatus(`THE YEAR HAS TO BE ${cutoff()} OR EARLIER`, "error");

    submit.dataset.busy = "1";
    submit.disabled = true;
    setRecStatus("RECORDING…", "busy");
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
          signals: picked,
          note: data.note,
          submitter: data.submitter,
          company: data.company,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (typeof body.prUrl === "string" && body.prUrl.startsWith("https://github.com/")) {
        const number = body.prUrl.match(/\/pull\/(\d+)/)?.[1];
        setRecStatus(`TAPE FILED ✓ ${number ? `PR #${number}` : ""} `);
        const link = document.createElement("a");
        link.href = body.prUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "OPEN";
        $("form-status").append(link);
      } else if (body.ok) {
        setRecStatus(String(body.message || "Tape received ✓"));
        form.reset();
        for (const radio of radios) radio.checked = radio.value === data.channel;
        syncRadios();
        syncEcho();
      } else {
        setRecStatus(String(body.error || "THE DECK JAMMED").toUpperCase(), "error");
      }
    } catch {
      setRecStatus("THE DECK JAMMED BEFORE IT REACHED THE SHELF", "error");
    } finally {
      delete submit.dataset.busy;
      syncSignals();
    }
  });
}

function wire() {
  $("btn-up").addEventListener("click", () => castVote("up"));
  $("btn-down").addEventListener("click", () => castVote("down"));
  $("btn-play").addEventListener("click", onPlay);
  $("btn-pause").addEventListener("click", () => {
    if (mobileQuery.matches && (mode === "paused" || mode === "stopped")) onPlay();
    else onPause();
  });
  $("btn-stop").addEventListener("click", onStop);
  bindSeek("btn-rew", -1);
  bindSeek("btn-fwd", 1);
  wireNav();
  wireTuner();
  for (const lamp of $$("button.lamp")) lamp.addEventListener("click", backToLive);
  $("sound-hint").addEventListener("click", unlockSound);

  // windowshade (desktop studs) + accordions (mobile titlebars)
  for (const stud of $$("[data-shade]")) {
    stud.addEventListener("click", () => {
      const win = stud.closest(".win");
      win.dataset.shaded = win.dataset.shaded === "true" ? "false" : "true";
    });
  }
  for (const toggle of $$(".win__toggle")) {
    toggle.addEventListener("click", () => {
      if (!mobileQuery.matches) return;
      const win = toggle.closest(".win");
      const open = !win.classList.contains("is-open");
      win.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  wireRec();

  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === " " && tag !== "BUTTON" && tag !== "A") {
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

  mobileQuery.addEventListener?.("change", () => updateChrome(mode === "stopped" ? null : spotAt(playlist(), position())));
  addEventListener("resize", sizeMarquee);
  document.fonts?.ready.then(sizeMarquee);
  if (!reduceMotion && !snowTimer) snowTimer = setInterval(drawSnow, 80);
}

async function initialChannel() {
  const params = new URLSearchParams(location.search);
  const tv = params.get("tv");
  const query = params.get("channel");
  const hash = location.hash.replace("#", "");
  if (tv && channels.has(tv) && !query && !channels.has(hash)) return tv;
  // The real /suomi URL (own share card) opens the Suomi TV unless a hash or ?channel says otherwise.
  if (/^\/suomi\/?$/.test(location.pathname) && !query && !channels.has(hash) && !channels.has(`international-${hash}`)) return "suomi";
  for (const candidate of [query, hash]) {
    if (channels.has(candidate)) return candidate;
    if (candidate && channels.has(`international-${candidate}`)) return `international-${candidate}`;
  }
  try {
    const saved = localStorage.getItem(CHANNEL_KEY);
    if (channels.has(saved)) return saved;
  } catch {
    /* ignore */
  }
  // No explicit or saved choice: default the TV from the visitor's country (Suomi in Finland).
  try {
    const geo = await Promise.race([fetch("/api/geo").then((r) => (r.ok ? r.json() : null)), new Promise((resolve) => setTimeout(() => resolve(null), 1200))]);
    if (geo?.tv && channels.has(geo.tv)) return geo.tv;
  } catch {
    /* default */
  }
  return "international";
}

/** Most popular tape: best Wilson lower bound over all votes so far; a curated pick when nobody has voted. */
const CURATED_TOP = { international: ["leeroy-jenkins", "numa-numa", "badgers"], suomi: ["b5mies", "kahen-kilon-siika", "ismo-seppo-pyorailee"] };
export function topTapeId(id) {
  const channel = channels.get(id);
  const live = (channel?.items || []).filter((item) => item.status !== "pending" && item.duration > 0);
  const stats = statsFor(topStats, id);
  let best = null;
  for (const item of live) {
    const row = stats[item.id];
    const votes = (row?.up || 0) + (row?.down || 0);
    if (!row || votes < 1) continue;
    const score = Number(row.wilson) || 0;
    if (!best || score > best.score || (score === best.score && votes > best.votes)) best = { id: item.id, score, votes };
  }
  if (best && best.score > 0) return best.id;
  return (CURATED_TOP[id] || CURATED_TOP[langOf(id)] || []).find((tid) => live.some((item) => item.id === tid)) || live[0]?.id;
}

/** Jump the deck to the next airing of the channel's most popular tape, from its first second. */
function jumpToTop() {
  const items = playlist();
  const target = topTapeId(channelId);
  const total = totalDuration(items);
  if (!target || !total) return goLive();
  const live = liveSeconds(items, Date.now());
  let start = 0;
  let best = null;
  for (const item of items) {
    if (item.id === target) {
      const ahead = (start - live + total) % total;
      if (best === null || ahead < best.ahead) best = { start, ahead };
    }
    start += item.duration;
  }
  if (best) {
    setTimeshift(best.start);
    shuffleRun = true;
  } else goLive();
}

function finishIntro() {
  if (!introActive) return;
  introActive = false;
  stopVideo();
  hideCard();
  jumpToTop();
  glitch();
  loadCurrent(true);
}

function playIntro() {
  const gen = ++loadGen;
  loadedKey = "intro";
  hideCard();
  $("poster").hidden = true;
  updateChrome({ item: INTRO, index: -1, offset: 0, start: 0, total: INTRO.duration });
  document.title = "Winamp · Plebflix TV";
  playVideo(INTRO, 0, gen, finishIntro);
  // Never let the intro hold the deck hostage.
  setTimeout(finishIntro, 12000);
}

async function boot() {
  buildEq();
  fetch("/sources.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      shelfHosts = (body?.shelves || []).flatMap((shelf) => (shelf.hosts || []).map((name) => ({ name, subdomains: Boolean(shelf.subdomains) })));
    })
    .catch(() => {});
  try {
    const lineup = await fetch("/channels/index.json").then((r) => (r.ok ? r.json() : { channels: LANGS.map((id, i) => ({ id, lang: id, cat: "all", number: 1, short: SHORT[id], kind: "all", name: id })) }));
    ORDER = lineup.channels.map((c) => c.id);
    for (const c of lineup.channels) {
      META.set(c.id, c);
      SHORT[c.id] = c.short || c.id.toUpperCase();
    }
    const docs = await Promise.all(ORDER.map((id) => fetch(`/channels/${id}.json`).then((response) => response.json())));
    ORDER.forEach((id, i) => {
      const m = META.get(id);
      channels.set(id, { ...docs[i], name: m.name || docs[i].name, tagline: m.tagline || docs[i].tagline, number: m.number, lang: m.lang });
    });
  } catch {
    showCard("NO TAPE");
    setMarquee("NO TAPE ★ THE SHELF DIDN'T LOAD ★");
    return;
  }
  channelId = await initialChannel();
  applyChannelChrome();
  let acceptStats = true;
  const pullStats = Promise.all(
    LANGS.map(async (id) => {
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
  const tomorrow = dayKey(Date.now() + 86400000);
  const pullTop = Promise.all(
    LANGS.map(async (id) => {
      try {
        const response = await fetch(`/api/stats?channel=${id}&day=${tomorrow}`);
        if (response.ok) topStats[id] = (await response.json())?.items || {};
      } catch {
        /* curated pick */
      }
    }),
  );
  await Promise.race([Promise.all([pullStats, pullTop]), new Promise((resolve) => setTimeout(resolve, 1500))]);
  acceptStats = false;
  broadcastCache = null;
  wire();
  glitch();
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (PLAY_MODES.includes(saved) && saved !== "live") playMode = saved;
  } catch {
    /* ignore */
  }
  $("btn-mode").addEventListener("click", cycleMode);
  $("btn-live").addEventListener("click", backToLive);
  paintMode();
  tick();
  setInterval(tick, 250);
}

boot();

/* ── v3: absolute seeking — skip/back, schedule rows, scrubbable progress ── */
let scrubbing = false;
export function seekTo(pos, opts = {}) {
  const items = playlist();
  const total = totalDuration(items);
  if (!total) return;
  if (introActive) {
    introActive = false;
    stopVideo();
  }
  const next = ((pos % total) + total) % total;
  shuffleRun = Boolean(opts.shuffle);
  userSeeked = true;
  lastClip = null;
  hideCard();
  if (mode === "paused") pausePos = next;
  else setTimeshift(next);
  if (!opts.quiet) glitch();
  loadCurrent(true);
}
function currentSpot() {
  const items = playlist();
  return items.length ? spotAt(items, position()) : null;
}
/** Start of the n-th clip (skipping idents) after (dir 1) or before (dir -1) the current one. */
export function neighbourStart(items, spot, dir) {
  const total = totalDuration(items);
  let index = spot.index;
  let at = spot.start;
  for (let step = 0; step < items.length; step += 1) {
    if (dir > 0) {
      at += items[index].duration;
      index = (index + 1) % items.length;
    } else {
      index = (index - 1 + items.length) % items.length;
      at -= items[index].duration;
    }
    if (items[index].kind !== "ident") return ((at % total) + total) % total;
  }
  return spot.start;
}
function skip(dir) {
  const items = playlist();
  const spot = currentSpot();
  if (!spot) return;
  if (mode === "stopped") mode = "live";
  if (playMode === "shuffle" && !(dir < 0 && spot.item.kind !== "ident" && spot.offset > 4)) {
    if (dir > 0) {
      lastClip = spot.item.kind !== "ident" ? { id: spot.item.id } : lastClip;
      const next = nextShuffleStart(items);
      if (next !== null) return seekTo(next);
    } else if (shuffleHistory.length) {
      const prev = shuffleHistory.pop();
      shuffleQueue.unshift(spot.item.id);
      const at = occurrenceStart(items, prev);
      if (at !== null) return seekTo(at);
    }
  }
  if (dir < 0 && spot.item.kind !== "ident" && spot.offset > 4) return seekTo(spot.start);
  seekTo(neighbourStart(items, spot, dir), { shuffle: shuffleRun });
}
function scrubFraction(event) {
  const rect = $("scrub").getBoundingClientRect();
  return Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
}
function scrubTo(frac, commit) {
  const spot = currentSpot();
  if (!spot || !spot.item.duration) return;
  $("scrub").style.setProperty("--p", `${(frac * 100).toFixed(2)}%`);
  $("lcd-tc").textContent = `${tc(frac * spot.item.duration)} / ${tc(spot.item.duration)}`;
  showTip(frac);
  if (commit) seekTo(spot.start + frac * spot.item.duration, { quiet: true, shuffle: shuffleRun });
}
/** Hover / drag time preview above the scrubber. */
function showTip(frac) {
  const tip = $("scrub-tip");
  const spot = currentSpot();
  if (!tip || !spot || !spot.item.duration || spot.item.kind === "ident") return hideTip();
  tip.hidden = false;
  tip.textContent = `${tc(frac * spot.item.duration)} / ${tc(spot.item.duration)}`;
  tip.style.left = `${(frac * 100).toFixed(2)}%`;
}
function hideTip() {
  const tip = $("scrub-tip");
  if (tip) tip.hidden = true;
}
function announceTape(item) {
  window.dispatchEvent(new CustomEvent("plebflix:tape", { detail: { item, channel: channelId } }));
}
/** Play a tape by id: stay on this channel if it carries it, else go to the tape's language channel. */
export function playTape(id) {
  const has = (cid) => (channels.get(cid)?.items || []).some((item) => item.id === id);
  let target = has(channelId) ? channelId : has(langOf()) ? langOf() : LANGS.find(has) || ORDER.find(has);
  if (!target) return false;
  if (target !== channelId) {
    channelId = target;
    try {
      localStorage.setItem(CHANNEL_KEY, target);
    } catch {
      /* ignore */
    }
    history.replaceState(null, "", `#${target}`);
    applyChannelChrome();
    tune();
  }
  if (mode === "stopped") mode = "live";
  const items = playlist();
  const total = totalDuration(items);
  const here = position();
  let at = 0;
  let best = null;
  for (const item of items) {
    if (item.id === id) {
      const ahead = (at - here + total) % total;
      if (best === null || ahead < best.ahead) best = { at, ahead };
    }
    at += item.duration;
  }
  if (!best) return false;
  seekTo(best.at);
  return true;
}
window.plebflix = {
  seekTo,
  playTape,
  skip: (d) => skip(d),
  catalog: () => ORDER.map((id) => ({ id, name: channels.get(id)?.name, short: SHORT[id], items: channels.get(id)?.items || [] })),
  state: () => ({ mode, channelId, spot: currentSpot(), introActive }),
};
function wireNav() {
  $("btn-next").addEventListener("click", () => skip(1));
  $("btn-prev").addEventListener("click", () => skip(-1));
  const list = $("sched");
  const pick = (event) => {
    const row = event.target.closest?.(".sched__row[data-at]");
    if (!row) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (mode === "stopped") mode = "live";
    seekTo(Number(row.dataset.at));
  };
  list.addEventListener("click", pick);
  list.addEventListener("keydown", pick);
  const bar = $("scrub");
  bar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    scrubbing = true;
    bar.setPointerCapture?.(event.pointerId);
    bar.classList.add("is-scrubbing");
    scrubTo(scrubFraction(event), false);
  });
  bar.addEventListener("pointermove", (event) => {
    if (scrubbing) scrubTo(scrubFraction(event), false);
    else if (event.pointerType === "mouse") showTip(scrubFraction(event));
  });
  bar.addEventListener("pointerleave", () => {
    if (!scrubbing) hideTip();
  });
  const end = (event) => {
    if (!scrubbing) return;
    scrubbing = false;
    bar.classList.remove("is-scrubbing");
    scrubTo(scrubFraction(event), true);
    if (event.pointerType !== "mouse") setTimeout(hideTip, 700);
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", () => {
    scrubbing = false;
    bar.classList.remove("is-scrubbing");
    hideTip();
  });
  bar.addEventListener("keydown", (event) => {
    const spot = currentSpot();
    if (!spot || !spot.item.duration) return;
    const d = event.key === "ArrowRight" ? 5 : event.key === "ArrowLeft" ? -5 : 0;
    if (!d) return;
    event.preventDefault();
    seekTo(spot.start + Math.min(spot.item.duration - 1, Math.max(0, spot.offset + d)), { quiet: true, shuffle: shuffleRun });
  });
}

import { syncFavicon } from "./favicon-mode.js";
import { archiveFile, sources, youtubePoster } from "./play.js";
import { buildBroadcast, dayKey, dayStartSeconds, liveItems, liveSeconds, resolveDefinition, spotAt, shiftFromLive, totalDuration, DAY_SECONDS } from "./schedule.js";

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
/** channels/schedule.json: how each channel airs (order, hold-out, idents, fixed slots). */
let scheduleDoc = null;
/** `build` from channels/index.json: names the catalog + schedule + generator this tab holds. */
let buildStamp = "";
let channelId = "international";
let mode = "live";
/**
 * Why the deck is off the broadcast clock while mode is "timeshift": "seek" (REW, FWD, the scrubber, a resumed
 * pause — the lamp reads TIMESHIFT ±mm:ss, you are still on the broadcast, shifted) or "skip" (Skip/Back, a
 * schedule row, search — CONTINUOUS: the programme plays on from the tape you picked). GO LIVE clears it.
 */
let shiftKind = "";
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
/** Tape ids whose embed returned 101/150 (or another fatal player error) this session. */
const brokenEmbeds = new Set();
/** The current tape's sources, in the order they are being tried, and which one is up. */
let sourceList = [];
let sourceAt = 0;
/** Fires when an archive.org stream has not started in time. */
let streamTimer = 0;
/** Fires when YouTube has not reached PLAYING in time. */
let ytWatch = 0;
/** The Vimeo source on the glass, its tape, and the last second it reported. */
let vimeoSource = null;
let vimeoItem = null;
let vimeoClock = 0;
/** Fires to try a NO SIGNAL tape's sources again. */
let signalRetry = 0;
/** The tape loadCurrent last asked the embed to play. */
let currentItem = null;
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

/** Device clock minus the server clock, applied only when they disagree by more than three seconds. */
let clockSkew = 0;
/** The broadcast clock. Timers that only pace this browser keep using Date.now(). */
const now = () => Date.now() + clockSkew;
function noteServerClock(response) {
  const server = Date.parse(response?.headers?.get("date") || "");
  if (!server) return;
  const skew = server + 500 - Date.now(); // the Date header is whole seconds; +500 ms is the expected truncation
  clockSkew = Math.abs(skew) > 3000 ? skew : 0;
}

function wallSec() {
  return Math.floor(now() / 1000);
}

const randomId = () =>
  crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
let memoryViewerId = "";

function viewerId() {
  const key = "plebflix-viewer";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = randomId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Storage blocked: a random id for this page load, never one id shared by every such viewer.
    memoryViewerId ||= randomId();
    return memoryViewerId;
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

/**
 * The UTC day the stats snapshot in statsMap is for. The day's lineup is drawn from the votes cast before that
 * day began (the Worker freezes that snapshot), so every viewer who holds it builds the same programme. A fetch
 * that fails or arrives late is retried / accepted: the lineup rebuilds once and the deck joins everyone else.
 */
let statsDay = "";
let statsPending = null;
/** language id → the day its snapshot in statsMap is for */
const statsLoaded = {};
async function pullStats(day, ids = LANGS) {
  await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetch(`/api/stats?channel=${id}&day=${day}`);
        noteServerClock(response);
        if (!response.ok) return;
        const body = await response.json();
        if (body?.items && typeof body.items === "object" && !Array.isArray(body.items)) {
          statsMap[id] = body.items;
          statsLoaded[id] = day;
        }
      } catch {
        /* retried by ensureStats; until then the day airs unweighted */
      }
    }),
  );
}
function ensureStats() {
  if (!statsDay || statsPending) return;
  const missing = LANGS.filter((id) => statsLoaded[id] !== statsDay);
  if (!missing.length) return;
  statsPending = pullStats(statsDay, missing).finally(() => {
    statsPending = null;
  });
}

function playlist(id = channelId) {
  const channel = channels.get(id);
  if (!channel) return [];
  const day = dayKey(now());
  if (statsDay && day !== statsDay) {
    // Midnight UTC: today's snapshot now includes yesterday's votes. Switch days at once (so a failed fetch is
    // retried by ensureStats instead of every tick) and pull the new snapshot; the lineup rebuilds when it lands.
    statsDay = day;
    ensureStats();
  }
  const stats = statsFor(statsMap, id);
  const sig = JSON.stringify(stats);
  if (!broadcastCache || broadcastCache.id !== id || broadcastCache.day !== day || broadcastCache.sig !== sig) {
    broadcastCache = {
      id,
      day,
      sig,
      items: buildBroadcast(channel, now(), stats, resolveDefinition(scheduleDoc, id)),
    };
  }
  return broadcastCache.items;
}

function position() {
  const items = playlist();
  if (!items.length || mode === "stopped") return 0;
  if (mode === "paused") return pausePos;
  if (mode === "live") return liveSeconds(items, now());
  const total = totalDuration(items);
  const elapsed = wallSec() - anchorWall;
  return ((anchorPos + elapsed) % total + total) % total;
}

function setTimeshift(seconds, kind = shiftKind || "seek") {
  const total = totalDuration(playlist()) || 1;
  anchorPos = ((seconds % total) + total) % total;
  anchorWall = wallSec();
  mode = "timeshift";
  shiftKind = kind;
  brokenHold = false;
}

function goLive() {
  shuffleRun = false;
  lastClip = null;
  mode = "live";
  shiftKind = "";
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
  syncFavicon(mode, playMode);
  const channel = channels.get(channelId);
  const number = channelNumber();
  const short = SHORT[channelId] || "";
  const item = mode === "stopped" ? null : spot?.item || null;
  const isClip = Boolean(item && item.kind !== "ident");
  const items = playlist();
  const total = totalDuration(items);
  const here = mode === "stopped" ? 0 : position();
  const delta = total ? shiftFromLive(here, liveSeconds(items, now()), total) : 0;

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

  // lamps: LIVE (on the clock) · PAUSE −mm:ss · TIMESHIFT ±mm:ss (REW/FWD) · CONTINUOUS (skipped) · LOOP / SHUFFLE · STOP
  const shift = `${delta >= 0 ? "+" : "−"}${tc(delta < 0 ? -delta : delta)}`;
  if (mode === "stopped") setLamps("stopped", "STOP");
  else if (mode === "live" && !seekingDir) setLamps("live", "LIVE");
  else if (mode === "paused") setLamps("timeshift", Math.abs(delta) < 2 ? "PAUSE" : `PAUSE ${shift}`);
  else if (mode === "timeshift" && playMode !== "live") setLamps("timeshift", playMode.toUpperCase());
  else if (mode === "timeshift" && shiftKind === "skip" && !seekingDir) setLamps("timeshift", "CONTINUOUS");
  else setLamps("timeshift", `TIMESHIFT ${shift}`);

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
    // desktop: PAUSE latches; pressing it again plays on
    pause.setAttribute("aria-pressed", String(latched === "pause"));
    pause.setAttribute("aria-label", latched === "pause" ? "Paused — press again to play on" : "Pause");
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

  $("sound-hint").hidden = soundAllowed() || mode === "stopped";

  // SOURCE pill → the tape's original_url
  const source = $("source");
  const url = isClip ? item.original_url : "";
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    source.href = url;
    source.removeAttribute("aria-disabled");
    source.removeAttribute("tabindex");
    // The pill links the tape's original page. Its label says what is on the glass right now.
    const onAir = $("stage").dataset.source?.split(":")[0];
    $("source-host").textContent = onAir === "archive" ? "archive.org" : onAir === "wayback" ? "web.archive.org" : onAir === "youtube" ? "youtube.com" : onAir === "vimeo" ? "vimeo.com" : sourceLabel(url);
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
  if (mode === "timeshift") return playMode === "loop" ? "LOOP" : playMode === "shuffle" ? "SHUFFLE" : shiftKind === "skip" ? "CONTINUOUS" : "TIMESHIFT";
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

/**
 * Schedule window: the whole UTC day's programme at local wall-clock times, like a TV guide. The inverse row is
 * ON AIR on the shared clock (click it to join the broadcast); an outlined row is where this viewer is while off
 * the broadcast (CONTINUOUS, TIMESHIFT, PAUSE). Rows are built once per channel and day; ticks only move markers.
 */
let schedRows = [];
let schedLiveIndex = -1;
let schedHereIndex = -1;
let schedFollowed = null;
let schedScrolledAt = 0;
let schedAutoScrollUntil = 0;
const dayLabel = (epochMs) => new Date(epochMs).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "numeric" }).toUpperCase();

function renderSchedule(spot) {
  const channel = channels.get(channelId);
  const items = playlist();
  const list = $("sched");
  $("sched-ch").textContent = `CH ${channelNumber()} ${channel?.name || ""}`;
  $("sched-tagline").textContent = channel?.tagline || "";

  if (!items.length) {
    if (lastSchedKey !== `${channelId}:empty`) {
      lastSchedKey = `${channelId}:empty`;
      schedRows = [];
      list.innerHTML = `<li class="sched__empty">NO TAPE</li>`;
      $("peek").textContent = "—";
      $("sched-foot").textContent = "0 TAPES · ALL TIMES LOCAL";
    }
    return;
  }
  const at0 = now();
  const dayStartMs = dayStartSeconds(at0) * 1000;
  const key = `${channelId}:${broadcastCache?.day}:${items.length}`;
  if (key !== lastSchedKey) {
    lastSchedKey = key;
    schedLiveIndex = -1;
    schedHereIndex = -1;
    schedFollowed = null;
    const lang = langOf() === "suomi" ? ' lang="fi"' : "";
    const html = [];
    schedRows = new Array(items.length).fill(null);
    let at = 0;
    let lastDay = "";
    items.forEach((item, index) => {
      if (item.kind !== "ident" && at < DAY_SECONDS) {
        const when = dayStartMs + at * 1000;
        const day = dayLabel(when);
        if (day !== lastDay) {
          lastDay = day;
          html.push(`<li class="sched__day" aria-hidden="true"><span>${escapeHtml(day)}</span><span>CH ${channelNumber()}</span></li>`);
        }
        html.push(
          `<li class="sched__row" data-at="${at}" data-index="${index}" tabindex="0" role="button" title="Play ${escapeHtml(item.title)}">` +
            `<span class="sched__time">${hhmm(when)}</span><span class="sched__title"${lang}>${escapeHtml(item.title)}</span>` +
            `<span class="sched__year">${escapeHtml(item.year ?? "")}</span><span class="sched__dur">${fmt(item.duration)}</span></li>`,
        );
      }
      at += item.duration;
    });
    list.innerHTML = html.join("");
    for (const li of list.querySelectorAll(".sched__row")) schedRows[Number(li.dataset.index)] = li;
    $("sched-foot").textContent = `${liveItems(channel, at0).length} TAPES · TODAY'S PROGRAMME · ALL TIMES LOCAL`;
    if (lang) $("peek").setAttribute("lang", "fi");
    else $("peek").removeAttribute("lang");
  }

  // ON AIR: the broadcast's own position, whatever this deck is doing.
  const liveSpot = spotAt(items, liveSeconds(items, at0));
  const liveIndex = liveSpot ? liveSpot.index : -1;
  if (liveIndex !== schedLiveIndex) {
    const rewound = schedLiveIndex < 0 || schedLiveIndex > liveIndex;
    const from = rewound ? 0 : schedLiveIndex;
    for (let index = from; index < liveIndex; index += 1) schedRows[index]?.classList.add("sched__row--past");
    if (rewound) for (let index = liveIndex; index < schedRows.length; index += 1) schedRows[index]?.classList.remove("sched__row--past");
    const was = schedRows[schedLiveIndex];
    if (was) {
      was.classList.remove("sched__row--now");
      was.removeAttribute("aria-current");
    }
    const row = schedRows[liveIndex];
    if (row) {
      row.classList.add("sched__row--now");
      row.classList.remove("sched__row--past");
      row.setAttribute("aria-current", "true");
    }
    schedLiveIndex = liveIndex;
    let next = liveIndex + 1;
    while (next < items.length && !schedRows[next]) next += 1;
    const nextRow = schedRows[next];
    $("peek").textContent = nextRow ? `${hhmm(dayStartMs + Number(nextRow.dataset.at) * 1000)}  ${items[next].title}  ${items[next].year ?? ""}` : "—";
  }
  // HERE: this viewer, when off the broadcast.
  const hereIndex = spot && mode !== "stopped" && mode !== "live" ? spot.index : -1;
  if (hereIndex !== schedHereIndex) {
    schedRows[schedHereIndex]?.classList.remove("sched__row--here");
    schedRows[hereIndex]?.classList.add("sched__row--here");
    schedHereIndex = hereIndex;
  }
  // progress hairlines: the broadcast's on the ON AIR row, this viewer's on the outlined row
  const liveRow = schedRows[liveIndex];
  if (liveRow && liveSpot.item.duration) liveRow.style.setProperty("--p", `${Math.min(100, (liveSpot.offset / liveSpot.item.duration) * 100).toFixed(1)}%`);
  const hereRow = hereIndex >= 0 ? schedRows[hereIndex] : null;
  if (hereRow && hereRow !== liveRow && spot.item.duration) hereRow.style.setProperty("--p", `${Math.min(100, (spot.offset / spot.item.duration) * 100).toFixed(1)}%`);
  followRow(hereRow || liveRow, list);
}

/** Keep the row that matters near the top of the well, unless the viewer scrolled the guide in the last 20 s. */
function followRow(row, list) {
  if (!row || row === schedFollowed) return;
  const well = list.parentElement;
  if (!well || !well.clientHeight || Date.now() - schedScrolledAt < 20000) return;
  schedFollowed = row;
  schedAutoScrollUntil = Date.now() + 400;
  well.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - row.offsetHeight * 1.5);
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
  playerKind = "ident";
}

/** Every source refused. The tape keeps its slot on the shared schedule and says so; verify-all-play counts it as a failure. */
function showNoSignal(item) {
  stopVideo();
  destroyYoutube();
  hideEmbed();
  destroySwf();
  $("poster").hidden = true;
  const card = $("card");
  card.hidden = false;
  card.classList.remove("ident");
  $("card-mark").textContent = item.title || "PLEBFLIX";
  $("card-sub").textContent = "NO SIGNAL";
  playerKind = "none";
  markSource("none");
  // A busy archive node or a slow start can clear. The tape keeps its slot, so try its sources again.
  clearTimeout(signalRetry);
  signalRetry = setTimeout(() => {
    if (item !== currentItem || playerKind !== "none" || mode === "stopped") return;
    hideCard();
    sourceAt = 0;
    showPoster(item);
    const spot = spotAt(playlist(), mode === "paused" ? pausePos : position());
    startSource(item, spot?.item.id === item.id ? spot.offset : 0, loadGen);
  }, 20000);
}

/** What is on the glass right now: "youtube:<id>", "archive:<id>", "image:<url>", "none", or empty while it starts. */
function markSource(value) {
  $("stage").dataset.source = value;
}

function showPoster(item) {
  const poster = $("poster");
  const list = sources(item);
  const youtube = list.find((source) => source.kind === "youtube");
  const archive = list.find((source) => source.kind === "archive");
  poster.hidden = false;
  poster.style.opacity = "1";
  poster.alt = "";
  poster.onload = null;
  if (youtube) {
    poster.src = youtubePoster(youtube.id);
    poster.onerror = () => {
      poster.onerror = null;
      poster.src = youtubePoster(youtube.id, "mqdefault");
    };
    return;
  }
  if (archive) {
    poster.onerror = () => {
      poster.onerror = null;
      poster.removeAttribute("src");
      poster.hidden = true;
    };
    poster.src = `https://archive.org/services/img/${encodeURIComponent(archive.id)}`;
    return;
  }
  poster.onerror = null;
  poster.removeAttribute("src");
  poster.hidden = true;
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

function destroyYoutube() {
  clearTimeout(ytWatch);
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
  if (playerKind === "archive" && vid) vid.muted = false;
  if (playerKind === "vimeo") {
    vimeoSend("setMuted", false);
    vimeoSend("setVolume", 1);
  }
}

let vid = $("vid");

function stopVideo() {
  clearTimeout(streamTimer);
  if (!vid) return;
  vid.pause();
  vid.hidden = true;
  vid.onended = vid.onerror = vid.onplaying = null;
  if (vid.getAttribute("src")) {
    vid.removeAttribute("src");
    vid.load();
  }
}

/** A file streamed from archive.org into the deck's own <video>: seek, pause, sound and the EQ all work on it. */
function playArchive(item, source, offset, attempt = 0) {
  stopVideo();
  destroyYoutube();
  hideEmbed();
  destroySwf();
  playerKind = "archive";
  vid.hidden = false;
  // The element paints black until its first frame after the seek. The poster stays up until the stream plays.
  vid.style.opacity = "0";
  vid.muted = !soundAllowed();
  vid.onloadedmetadata = () => {
    vid.onloadedmetadata = null;
    if (offset > 1 && Number.isFinite(vid.duration)) vid.currentTime = Math.min(offset, Math.max(0, vid.duration - 1));
  };
  vid.onplaying = () => {
    clearTimeout(streamTimer);
    vid.style.opacity = "1";
    $("poster").style.opacity = "0";
    markSource(`${source.kind}:${source.id}`);
  };
  vid.onended = () => {
    if (mode !== "paused" && mode !== "stopped") advance("end");
  };
  vid.onerror = () => {
    // A decode error repeats at the same frame every time, so only the next source can help. Chrome raises it on some
    // archive.org derivatives after a second or two of picture. A network error is usually a busy archive node: retry.
    if (vid.error?.code === 2 && attempt < 2) {
      clearTimeout(streamTimer);
      streamTimer = setTimeout(() => {
        const spot = spotAt(playlist(), mode === "paused" ? pausePos : position());
        if (playerKind === "archive" && item === currentItem) playArchive(item, source, spot?.offset ?? offset, attempt + 1);
      }, 1500);
      return;
    }
    nextSource(item, "archive.org stream failed");
  };
  vid.src = archiveFile(source);
  if (mode === "paused") return;
  startStream(item);
}

function startStream(item) {
  clearTimeout(streamTimer);
  streamTimer = setTimeout(() => {
    if (playerKind === "archive") nextSource(item, "archive.org stream did not start");
  }, 30000);
  vid.play().catch(() => {
    // Sound without a gesture is refused. Muted always plays; the tap-for-sound hint is already up.
    vid.muted = true;
    vid.play().catch(() => {});
  });
}

/** Sends one command to the Vimeo player. */
function vimeoSend(method, value) {
  const target = $("embed").contentWindow;
  if (!target) return;
  target.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), "https://player.vimeo.com");
}

/**
 * Vimeo's player, driven over postMessage. No "playing" message within 10 seconds means it refused this viewer
 * (its security page sends nothing), so the slot goes to the next source.
 */
function playVimeo(item, source, offset) {
  stopVideo();
  destroyYoutube();
  destroySwf();
  playerKind = "vimeo";
  vimeoClock = Math.max(0, offset);
  clearTimeout(streamTimer);
  streamTimer = setTimeout(() => {
    if (playerKind === "vimeo") {
      hideEmbed();
      nextSource(item, "Vimeo did not start within 10 seconds");
    }
  }, 10000);
  const frame = $("embed");
  vimeoSource = source;
  vimeoItem = item;
  frame.hidden = false;
  frame.src = `https://player.vimeo.com/video/${encodeURIComponent(source.id)}?autoplay=${mode === "paused" ? 0 : 1}&muted=${soundAllowed() ? 0 : 1}&controls=0&autopause=0&dnt=1#t=${Math.floor(offset)}s`;
}

window.addEventListener("message", (event) => {
  if (event.origin !== "https://player.vimeo.com") return;
  if (prepared?.kind === "vimeo" && event.source === document.getElementById("embed-next")?.contentWindow) {
    onPreparedVimeo(event);
    return;
  }
  if (playerKind !== "vimeo" || event.source !== $("embed").contentWindow) return;
  let data = event.data;
  try {
    if (typeof data === "string") data = JSON.parse(data);
  } catch {
    return;
  }
  if (data?.event === "ready") {
    for (const value of ["playing", "finish", "error", "playProgress"]) vimeoSend("addEventListener", value);
    if (mode !== "paused") vimeoSend("play");
  }
  // A player that started before we subscribed never says "playing", but its clock still reports.
  if (data?.event === "playing" || data?.event === "playProgress") {
    clearTimeout(streamTimer);
    $("poster").style.opacity = "0";
    markSource(`vimeo:${vimeoSource?.id || ""}`);
  }
  if (data?.event === "playProgress" && typeof data.data?.seconds === "number") vimeoClock = data.data.seconds;
  if (data?.event === "finish" && mode !== "paused" && mode !== "stopped") advance("end");
  if (data?.event === "error" && !$("stage").dataset.source) {
    clearTimeout(streamTimer);
    hideEmbed();
    nextSource(vimeoItem, "Vimeo error");
  }
});

/** A still from its public host. It holds its slot, as the 7-second loops did. */
function showStill(item, source) {
  stopVideo();
  destroyYoutube();
  hideEmbed();
  destroySwf();
  playerKind = "image";
  const poster = $("poster");
  poster.onload = () => markSource(`image:${source.id}`);
  poster.onerror = () => nextSource(item, "image did not load");
  poster.hidden = false;
  poster.style.opacity = "1";
  poster.src = source.id;
}

/** Try the next source in the same slot. */
function nextSource(item, why) {
  console.warn(`[plebflix] ${item?.id || "?"}: ${why}`);
  sourceAt += 1;
  if (item !== currentItem) return;
  const spot = spotAt(playlist(), mode === "paused" ? pausePos : position());
  startSource(item, spot?.item === item || spot?.item.id === item.id ? spot.offset : 0, loadGen);
}

/**
 * A sign-in wall does not always raise onError. No PLAYING within 6 seconds hands the slot to the next source.
 * The last source keeps trying: a slow start is better than no signal.
 */
function watchYoutube(item) {
  clearTimeout(ytWatch);
  if (sourceAt >= sourceList.length - 1 || mode === "paused") return;
  ytWatch = setTimeout(() => {
    if (playerKind !== "youtube" || item !== currentItem || mode === "paused") return;
    destroyYoutube();
    nextSource(item, "YouTube did not start within 6 seconds");
  }, 6000);
}

async function startSource(item, offset, gen) {
  const source = sourceList[sourceAt];
  if (!source) {
    showNoSignal(item);
    return;
  }
  markSource("");
  if (source.kind === "image") {
    showStill(item, source);
    return;
  }
  if (source.kind === "archive" || source.kind === "wayback") {
    playArchive(item, source, offset);
    return;
  }
  if (source.kind === "vimeo") {
    playVimeo(item, source, offset);
    return;
  }
  stopVideo();
  destroySwf();
  hideEmbed();
  try {
    await loadApi();
  } catch {
    if (gen === loadGen) nextSource(item, "YouTube API did not load");
    return;
  }
  if (gen !== loadGen || mode === "stopped") return;
  ensureYtDiv();
  const start = Math.max(0, Math.floor(offset));
  watchYoutube(item);
  if (player && typeof player.loadVideoById === "function" && player.ytHost === source.host) {
    player.loadVideoById({ videoId: source.id, startSeconds: start });
    if (soundAllowed()) {
      player.unMute?.();
      player.setVolume?.(100);
    } else {
      player.mute?.();
    }
    if (mode === "paused") setTimeout(() => mode === "paused" && player?.pauseVideo?.(), 250);
    return;
  }
  destroyYoutube();
  ensureYtDiv();
  mountYoutube(source.id, start, source.host || "https://www.youtube-nocookie.com");
  watchYoutube(item);
}

/**
 * Sound is remembered for the tab, but a new page has had no tap yet and the browser refuses unmuted autoplay, which
 * leaves YouTube's big play button up. Until this page has been tapped, a tape starts muted.
 */
function soundAllowed() {
  return soundOn && (navigator.userActivation?.hasBeenActive ?? true);
}

/** Muted autoplay always runs. If a start was refused anyway, go muted, try again, and offer the tap. */
function ensureStarted(target) {
  setTimeout(() => {
    if (target !== player || mode === "paused" || mode === "stopped") return;
    const state = target.getPlayerState?.();
    if (state === 1 || state === 3) return;
    target.mute?.();
    target.playVideo?.();
    $("sound-hint").hidden = false;
  }, 1500);
}

function onReady(event) {
  player = event?.target || player;
  if (mode === "paused") player?.pauseVideo?.();
  if (soundAllowed()) {
    player?.unMute?.();
    player?.setVolume?.(100);
  } else {
    player?.mute?.();
    if (mode !== "paused") $("sound-hint").hidden = false;
  }
  if (mode === "paused") return;
  // Safari and others ignore the autoplay param, and start= is stale once the player has loaded. Mute comes first.
  const spot = spotAt(playlist(), position());
  if (spot && spot.item.id === currentItem?.id && spot.offset > 1) {
    ignoreUntil = Date.now() + 1500;
    player?.seekTo?.(spot.offset, true);
  }
  player?.playVideo?.();
  ensureStarted(player);
}

function currentPlayer(event) {
  return player && (!event?.target || event.target === player);
}

function onState(event) {
  if (!currentPlayer(event)) return;
  const playing = window.YT?.PlayerState?.PLAYING;
  const ended = window.YT?.PlayerState?.ENDED;
  if (event.data === playing) {
    $("poster").style.opacity = "0";
    streak = 0;
    clearTimeout(ytWatch);
    markSource(`youtube:${sourceList[sourceAt]?.id || ""}`);
  }
  if (event.data === ended && mode !== "paused" && mode !== "stopped") advance("end");
}

function onError(event) {
  if (mode === "stopped" || !currentPlayer(event)) return;
  const code = Number(event?.data);
  const item = currentItem;
  // 101 and 150: the owner disabled embedding, or YouTube's "not a bot" wall. 2/5/100/153: gone or unplayable.
  // Either way the slot stays and the next source takes it.
  console.warn(`[plebflix] embed error ${code} on ${item?.id || "?"} (${item?.title || ""}) ${sourceList[sourceAt]?.id || ""}`);
  if (code === 2 || code === 5 || code === 100 || code === 101 || code === 150 || code === 153) {
    if (item?.id) brokenEmbeds.add(item.id);
    destroyYoutube();
    nextSource(item, `YouTube error ${code}`);
  }
}

function mountYoutube(videoId, start, host) {
  playerKind = "youtube";
  player = new window.YT.Player(ensureYtDiv(), {
    host,
    width: "100%",
    height: "100%",
    videoId,
    playerVars: {
      autoplay: 1,
      mute: soundAllowed() ? 0 : 1,
      start,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
      origin: location.origin,
      widget_referrer: location.href,
    },
    events: { onReady, onError, onStateChange: onState },
  });
  player.ytHost = host;
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
  const key = `${channelId}:${broadcastCache?.day || dayKey(now())}:${spot.index}:${spot.item.id}`;
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
  if (same && force && playerKind === "archive") {
    ignoreUntil = Date.now() + 1500;
    if (Number.isFinite(vid.duration)) vid.currentTime = Math.min(spot.offset, Math.max(0, vid.duration - 1));
    if (mode === "paused") vid.pause();
    else startStream(spot.item);
    return;
  }
  if (same && force && playerKind === "vimeo") {
    ignoreUntil = Date.now() + 1500;
    vimeoSend("setCurrentTime", Math.max(0, spot.offset));
    vimeoSend(mode === "paused" ? "pause" : "play");
    return;
  }
  if (same && force && (playerKind === "image" || playerKind === "none")) return;
  if (cutToPrepared(key, spot.offset)) return;
  cancelPrepared();

  loadedKey = key;
  currentItem = spot.item;
  // YouTube stays first on every tape that has it. Each upload gets its nocookie embed, then www.youtube.com, because a
  // viewer's own sign-in only counts on www. The other sources are fallbacks. (Niko, 2026-11-01)
  sourceList = orderedSources(spot.item);
  sourceAt = 0;
  markSource("");
  noteImpression(spot.item);
  announceTape(spot.item);
  const gen = ++loadGen;
  ignoreUntil = Date.now() + 4000;
  hideCard();
  document.title = `${spot.item.title} · Plebflix TV`;
  showPoster(spot.item);
  stopVideo();
  await startSource(spot.item, spot.offset, gen);
}

/* ── The next tape, loaded ahead (A/B players) ────────────────────────────────────────────────────────────────── */

/** The next tape starts loading this long after this one starts, so SKIP cuts as cleanly as a natural end. */
const PRELOAD_AFTER_SECONDS = 3;
/** How long a source being prepared gets to prove it plays before the next one is tried. */
const PREPARE_TIMEOUT_MS = 20000;
/** Seconds a prepared stream plays, muted and hidden, so a decode fault shows before the cut. */
const STREAM_PROBE_SECONDS = 2.5;

/**
 * The tape after this one, being made ready underneath: { key, item, list, at, kind, source, ready, player }.
 * The same source walk the player uses runs here, ahead of time, so a dead source is gone before the cut.
 */
let prepared = null;
let prepareTimer = 0;

function orderedSources(item) {
  return sources(item).flatMap((source) =>
    source.kind === "youtube"
      ? [{ ...source, host: "https://www.youtube-nocookie.com" }, { ...source, host: "https://www.youtube.com" }]
      : [source],
  );
}

function prepareNext(spot, items) {
  if (mode !== "live" && mode !== "timeshift") return;
  if (playMode !== "live" || document.hidden) return;
  if (spot.offset < PRELOAD_AFTER_SECONDS && spot.item.duration - spot.offset > PRELOAD_AFTER_SECONDS) return;
  const index = (spot.index + 1) % items.length;
  const item = items[index];
  if (!item || item.kind === "ident" || item.id === spot.item.id) return;
  const key = `${channelId}:${broadcastCache?.day || dayKey(now())}:${index}:${item.id}`;
  if (prepared?.key === key) return;
  cancelPrepared();
  prepared = { key, item, list: orderedSources(item), at: -1, kind: "", source: null, ready: false, player: null };
  prepareSource(prepared);
}

/** Try the next source for the tape being prepared. Out of sources: the cut falls back to the normal load. */
function prepareSource(job) {
  if (job !== prepared) return;
  clearPreparedPlayers();
  job.at += 1;
  job.ready = false;
  const source = job.list[job.at];
  job.source = source || null;
  job.kind = source?.kind || "";
  if (!source) return;
  clearTimeout(prepareTimer);
  prepareTimer = setTimeout(() => prepareSource(job), PREPARE_TIMEOUT_MS);
  if (source.kind === "image") prepareImage(job, source);
  else if (source.kind === "vimeo") prepareVimeo(job, source);
  else if (source.kind === "youtube") prepareYoutube(job, source);
  else prepareStream(job, source);
}

function preparedReady(job) {
  if (job !== prepared) return;
  clearTimeout(prepareTimer);
  job.ready = true;
}

function prepareImage(job, source) {
  const image = new Image();
  image.onload = () => preparedReady(job);
  image.onerror = () => prepareSource(job);
  image.src = source.id;
}

function prepareStream(job, source) {
  const next = $("vid-next");
  next.hidden = false;
  next.muted = true;
  next.onerror = () => prepareSource(job);
  const proven = () => {
    next.ontimeupdate = next.onended = null;
    next.pause();
    next.currentTime = 0;
    preparedReady(job);
  };
  // A tape shorter than the probe proves itself by reaching its end.
  next.ontimeupdate = () => {
    if (next.currentTime >= Math.min(STREAM_PROBE_SECONDS, (next.duration || Infinity) / 2)) proven();
  };
  next.onended = proven;
  next.src = archiveFile(source);
  next.play().catch(() => prepareSource(job));
}

function prepareVimeo(job, source) {
  let frame = document.getElementById("embed-next");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "embed-next";
    frame.title = "Next embedded video";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    $("embed").after(frame);
  }
  frame.src = `https://player.vimeo.com/video/${encodeURIComponent(source.id)}?autoplay=1&muted=1&controls=0&autopause=0&dnt=1`;
}

function onPreparedVimeo(event) {
  const job = prepared;
  const frame = document.getElementById("embed-next");
  let data = event.data;
  try {
    if (typeof data === "string") data = JSON.parse(data);
  } catch {
    return;
  }
  const send = (method, value) => frame.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), "https://player.vimeo.com");
  if (data?.event === "ready") {
    for (const value of ["playing", "finish", "error", "playProgress"]) send("addEventListener", value);
    send("play");
  }
  if (job.ready) return;
  if (data?.event === "playing" || data?.event === "playProgress") {
    send("pause");
    send("setCurrentTime", 0);
    preparedReady(job);
  }
  if (data?.event === "error") prepareSource(job);
}

function prepareYoutube(job, source) {
  if (!window.YT?.Player) {
    loadApi().then(() => prepareYoutube(job, source)).catch(() => prepareSource(job));
    return;
  }
  if (job !== prepared || job.source !== source) return;
  const mount = document.createElement("div");
  mount.id = "yt-next";
  $("poster").after(mount);
  job.player = new window.YT.Player(mount, {
    host: source.host,
    width: "100%",
    height: "100%",
    videoId: source.id,
    playerVars: { autoplay: 1, mute: 1, start: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, origin: location.origin, widget_referrer: location.href },
    events: {
      onReady: (event) => {
        event.target.mute();
        event.target.playVideo();
      },
      onStateChange: (event) => {
        if (event.target === player) {
          onState(event);
          return;
        }
        if (job === prepared && !job.ready && event.data === window.YT?.PlayerState?.PLAYING) {
          event.target.pauseVideo();
          event.target.seekTo(0, true);
          preparedReady(job);
        }
      },
      onError: (event) => {
        if (event.target === player) onError(event);
        else if (job === prepared) prepareSource(job);
      },
    },
  });
  job.player.ytHost = source.host;
}

/** Empties the hidden players, keeping the job. */
function clearPreparedPlayers() {
  clearTimeout(prepareTimer);
  const next = $("vid-next");
  next.onerror = next.ontimeupdate = next.onended = null;
  next.hidden = true;
  if (next.getAttribute("src")) {
    next.removeAttribute("src");
    next.load();
  }
  document.getElementById("embed-next")?.remove();
  if (prepared?.player) {
    try {
      prepared.player.destroy();
    } catch {
      /* the iframe may already be gone */
    }
    prepared.player = null;
  }
  document.getElementById("yt-next")?.remove();
}

function cancelPrepared() {
  if (!prepared) return;
  clearPreparedPlayers();
  prepared = null;
}

/**
 * The cut. The next tape is already loaded and proven, so it takes the glass within this one task: no frame of poster
 * or black is painted in between. False when nothing is ready, and the normal load runs instead.
 */
function cutToPrepared(key, offset) {
  const job = prepared;
  if (!job || !job.ready || job.key !== key || !key || mode === "paused") return false;
  const source = job.source;
  clearTimeout(prepareTimer);
  prepared = null;
  const start = Math.max(0, offset);
  const nextPlayer = job.player;
  // Retire what was on the glass.
  stopVideo();
  destroyYoutube();
  hideEmbed();
  destroySwf();
  hideCard();
  clearTimeout(signalRetry);
  loadedKey = key;
  currentItem = job.item;
  sourceList = job.list;
  sourceAt = job.at;
  loadGen += 1;
  ignoreUntil = Date.now() + 3000;
  noteImpression(job.item);
  announceTape(job.item);
  document.title = `${job.item.title} · Plebflix TV`;
  markSource(`${source.kind}:${source.id}`);
  if (source.kind === "image") {
    showStill(job.item, source);
    return true;
  }
  $("poster").style.opacity = "0";
  if (source.kind === "youtube") {
    const frame = document.getElementById("yt-next");
    if (frame) frame.id = "yt";
    player = nextPlayer;
    playerKind = "youtube";
    if (start > 1) player.seekTo(start, true);
    if (soundAllowed()) {
      player.unMute?.();
      player.setVolume?.(100);
    }
    player.playVideo();
    ensureStarted(player);
  } else if (source.kind === "vimeo") {
    const old = $("embed");
    const frame = document.getElementById("embed-next");
    old.remove();
    frame.id = "embed";
    playerKind = "vimeo";
    vimeoSource = source;
    vimeoItem = job.item;
    vimeoClock = start;
    if (start > 1) vimeoSend("setCurrentTime", start);
    if (soundAllowed()) {
      vimeoSend("setMuted", false);
      vimeoSend("setVolume", 1);
    }
    vimeoSend("play");
  } else {
    // The two <video> elements trade names, so everything that looks for #vid finds the one on air.
    const old = vid;
    const next = $("vid-next");
    old.id = "vid-next";
    next.id = "vid";
    vid = next;
    playerKind = "archive";
    vid.onerror = () => nextSource(job.item, "archive.org stream failed");
    vid.onended = () => {
      if (mode !== "paused" && mode !== "stopped") advance("end");
    };
    vid.ontimeupdate = null;
    vid.style.opacity = "1";
    vid.hidden = false;
    vid.muted = !soundAllowed();
    if (start > 1 && Number.isFinite(vid.duration)) vid.currentTime = Math.min(start, Math.max(0, vid.duration - 1));
    vid.play().catch(() => {
      vid.muted = true;
      vid.play().catch(() => {});
    });
  }
  return true;
}

function syncDrift(spot) {
  if (playerKind === "vimeo") {
    if (mode === "paused" || mode === "stopped" || Date.now() < ignoreUntil) return;
    if (Math.abs(vimeoClock - spot.offset) > 4) {
      vimeoSend("setCurrentTime", spot.offset);
      ignoreUntil = Date.now() + 3000;
    }
    return;
  }
  if (playerKind === "archive") {
    if (mode === "paused" || mode === "stopped" || Date.now() < ignoreUntil || vid.readyState < 1) return;
    if (vid.paused && !vid.ended) vid.play().catch(() => {});
    if (spot.offset < vid.duration - 1 && Math.abs(vid.currentTime - spot.offset) > 3) {
      vid.currentTime = spot.offset;
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
  if (reason === "end") {
    if (mode === "live") {
      // The file ran out a moment before the broadcast clock does (durations are whole seconds). Cover the last
      // frame and let tick() cross the boundary on the shared clock; jumping ahead would turn LIVE into a timeshift.
      // A next tape already loaded cuts in now: it is under a second early, inside the drift tolerance.
      if (cutToPrepared(prepared?.key, 0)) return;
      $("poster").style.opacity = "1";
      return;
    }
    if (playMode === "loop" && spot.item.kind !== "ident") {
      setTimeshift(spot.start);
      loadCurrent(true);
      return;
    }
    if (playMode === "shuffle") {
      const pick = nextShuffleStart(items);
      if (pick !== null) {
        seekTo(pick);
        return;
      }
    }
  }
  const next = (spot.index + 1) % items.length;
  let start = 0;
  for (let i = 0; i < next; i += 1) start += items[i].duration;
  if (mode === "paused") pausePos = start;
  else if (reason === "error") setTimeshift(start, "skip");
  else setTimeshift(start);
  glitch();
  loadCurrent(true);
}

function nudge(delta) {
  const items = playlist();
  const total = totalDuration(items);
  if (!total) return;
  const base = mode === "paused" ? pausePos : mode === "timeshift" ? position() : liveSeconds(items, now());
  const next = ((base + delta) % total + total) % total;
  shuffleRun = false;
  userSeeked = true; // a deck seek, not a tape ending by itself: LOOP and SHUFFLE must not snap back
  lastClip = null;
  hideCard();
  shiftKind = "seek"; // REW / FWD / arrows: still the broadcast, shifted in time
  if (mode === "paused") pausePos = next;
  else setTimeshift(next, "seek");
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
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    nudge(dir * 15);
  });
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
  const stamp = `${dayKey(now())}:${homeOf(item)}:${item.id}`;
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
    const delta = total ? Math.abs(shiftFromLive(pausePos, liveSeconds(items, now()), total)) : 0;
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
  if (introActive) finishIntro();
  pausePos = position();
  mode = "paused";
  player?.pauseVideo?.();
  if (playerKind === "archive") vid.pause();
  if (playerKind === "vimeo") vimeoSend("pause");
  updateChrome(spotAt(playlist(), pausePos));
}

function onStop() {
  mode = "stopped";
  cancelPrepared();
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
  // Both TVs share one tab icon set (share.config.json v5; its state follows play/pause and the mode button), so only the theme colour follows the TV.
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
  syncFavicon(mode, playMode);
  if ($("lcd-mode")) {
    $("lcd-mode").textContent =
      playMode !== "live" ? label : mode === "timeshift" ? (shiftKind === "skip" ? "CONTINUOUS" : "TIMESHIFT") : mode === "paused" ? "PAUSE" : "LIVE";
  }
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
  const key = `${channelId}:${broadcastCache?.day || dayKey(now())}:${spot.index}:${spot.item.id}`;
  if (key !== loadedKey) loadCurrent(false);
  else {
    updateChrome(spot);
    syncDrift(spot);
    prepareNext(spot, items);
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

  // One field. The librarian works out title, year, channel and signals from the link itself.
  const syncEcho = () => {
    const value = urlInput.value.trim();
    const verdict = value ? hostVerdict(value) : null;
    submit.disabled = submit.dataset.busy === "1" || !verdict;
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
  urlInput.addEventListener("input", syncEcho);
  // Dropping a link is the whole gesture: a pasted URL files itself.
  urlInput.addEventListener("paste", () => {
    setTimeout(() => {
      syncEcho();
      if (!submit.disabled && hostVerdict(urlInput.value)) form.requestSubmit();
    }, 0);
  });

  const open = () => {
    syncEcho();
    setRecStatus("INSERT TAPE · PASTE A LINK TO A 10+ YEAR OLD CLASSIC");
    dialog.showModal();
    $("btn-rec").setAttribute("aria-pressed", "true");
    urlInput.focus();
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
    const verdict = hostVerdict(data.url || "");
    if (!verdict) return setRecStatus("THAT LINK WON'T PLAY · USE A FULL https:// URL", "error");

    submit.dataset.busy = "1";
    submit.disabled = true;
    setRecStatus("RECORDING…", "busy");
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: data.url, channel: langOf(), company: data.company }),
      });
      const body = await response.json().catch(() => ({}));
      if (body.ok) {
        setRecStatus(String(body.message || "Tape received ✓"));
        form.reset();
      } else {
        setRecStatus(String(body.error || "THE DECK JAMMED").toUpperCase(), "error");
      }
    } catch {
      setRecStatus("THE DECK JAMMED BEFORE IT REACHED THE SHELF", "error");
    } finally {
      delete submit.dataset.busy;
      syncEcho();
    }
  });
}

function wire() {
  $("btn-up").addEventListener("click", () => castVote("up"));
  $("btn-down").addEventListener("click", () => castVote("down"));
  $("btn-play").addEventListener("click", onPlay);
  $("btn-pause").addEventListener("click", () => {
    // PAUSE twice releases it; on mobile the key doubles as PLAY from STOP as well.
    if (mode === "paused" || (mobileQuery.matches && mode === "stopped")) onPlay();
    else onPause();
  });
  $("btn-stop").addEventListener("click", onStop);
  bindSeek("btn-rew", -1);
  bindSeek("btn-fwd", 1);
  wireNav();
  wireTuner();
  for (const lamp of $$("button.lamp")) lamp.addEventListener("click", backToLive);
  $("sound-hint").addEventListener("click", unlockSound);
  // The glass is the biggest key on the deck: a tap pauses, the next tap plays on (or wakes a stopped set).
  $("screen").addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, [role=button]")) return;
    if (mode === "live" || mode === "timeshift") onPause();
    else onPlay();
  });

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
  $("sched").parentElement?.addEventListener(
    "scroll",
    () => {
      if (Date.now() > schedAutoScrollUntil) schedScrolledAt = Date.now();
    },
    { passive: true },
  );

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return; // the scrubber or a schedule row already used this key
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
    else if (event.key === "ArrowUp") {
      event.preventDefault();
      stepChannel(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      stepChannel(-1);
    }
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
  const live = liveSeconds(items, now());
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
  introActive = false;
}

/**
 * channels/index.json → META / SHORT / ORDER, every channel document, channels/schedule.json. `fresh` revalidates
 * with the server (a deploy changed the build stamp under this tab). Throws when no language shelf loaded.
 */
async function loadCatalog(fresh) {
  const init = fresh ? { cache: "no-cache" } : undefined;
  const getJson = (url) => fetch(url, init).then((response) => (response.ok ? response.json() : null)).catch(() => null);
  const index = (await getJson("/channels/index.json")) || { channels: LANGS.map((id) => ({ id, lang: id, cat: "all", number: 1, short: SHORT[id], kind: "all", name: id })) };
  const order = index.channels.map((c) => c.id);
  const [docs, sched] = await Promise.all([Promise.all(order.map((id) => getJson(`/channels/${id}.json`))), getJson("/channels/schedule.json")]);
  const next = new Map();
  order.forEach((id, i) => {
    const m = index.channels[i];
    if (!docs[i] || !Array.isArray(docs[i].items)) return; // a channel that did not load is left off the dial
    next.set(id, { ...docs[i], name: m.name || docs[i].name, tagline: m.tagline || docs[i].tagline, number: m.number, lang: m.lang });
  });
  if (!LANGS.some((id) => next.has(id))) throw new Error("no channel loaded");
  META.clear();
  for (const c of index.channels) {
    META.set(c.id, c);
    SHORT[c.id] = c.short || c.id.toUpperCase();
  }
  channels.clear();
  for (const [id, doc] of next) channels.set(id, doc);
  ORDER = order.filter((id) => channels.has(id));
  scheduleDoc = sched;
  buildStamp = typeof index.build === "string" ? index.build : "";
  broadcastCache = null;
  lastSchedKey = "";
}

/** A deploy changed the shelf or the schedule under this tab: re-read the data and put the deck on the shared programme. */
async function refreshCatalog() {
  try {
    await loadCatalog(true);
  } catch {
    return; // keep what we have; the next poll tries again
  }
  if (!channels.has(channelId)) channelId = channels.has(langOf()) ? langOf() : ORDER[0];
  if ($("tuner")) delete $("tuner").dataset.lang; // rebuild the dial
  applyChannelChrome();
  loadedKey = "";
  if (mode === "stopped") updateChrome(null);
  else loadCurrent(true);
}

const POLL_MS = 5 * 60 * 1000;
let lastPoll = Date.now();
/** Every five minutes while the tab is visible: did a deploy change the catalog, the schedule or the generator? */
async function pollBuild() {
  lastPoll = Date.now();
  const index = await fetch("/channels/index.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (index && typeof index.build === "string" && index.build !== buildStamp) await refreshCatalog();
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
    await loadCatalog(false);
  } catch {
    showCard("NO TAPE");
    setMarquee("NO TAPE ★ THE SHELF DIDN'T LOAD ★");
    return;
  }
  channelId = await initialChannel();
  applyChannelChrome();
  // The day's programme is drawn from the vote snapshot the Worker froze at midnight UTC. Wait for it (a few
  // seconds at most) so the first tape is already the shared one; a late or failed answer is retried by
  // ensureStats and the lineup rebuilds once when it lands.
  statsDay = dayKey(now());
  await Promise.race([pullStats(statsDay), new Promise((resolve) => setTimeout(resolve, 4000))]);
  statsDay = dayKey(now());
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
  setInterval(ensureStats, 30000);
  setInterval(() => {
    if (document.visibilityState === "visible") pollBuild();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastPoll > POLL_MS) pollBuild();
  });
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
  if (mode === "stopped") snow.classList.remove("on"); // a quiet seek out of STOP would otherwise play under static
  shuffleRun = Boolean(opts.shuffle);
  userSeeked = true;
  lastClip = null;
  hideCard();
  // Skip, Back, a schedule row, search, the scrubber: the programme plays on from here (CONTINUOUS). A scrub
  // inside the tape that is on stays a timeshift.
  const kind = opts.seek ? "seek" : "skip";
  shiftKind = kind;
  if (mode === "paused") pausePos = next;
  else setTimeshift(next, kind);
  // A prepared target cuts in at once, so the tuning static would only hide it.
  const target = spotAt(items, next);
  const ready = prepared?.ready && target && prepared.key === `${channelId}:${broadcastCache?.day || dayKey(now())}:${target.index}:${target.item.id}`;
  if (!opts.quiet && !ready) glitch();
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
  if (commit) seekTo(spot.start + frac * spot.item.duration, { quiet: true, shuffle: shuffleRun, seek: true });
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
/** Category ids (mtv, komedia, …) of the channels that carry this tape. */
function categoriesOf(item) {
  const cats = ORDER.filter((id) => META.get(id)?.kind === "category" && (channels.get(id)?.items || []).some((entry) => entry.id === item.id)).map((id) => META.get(id).cat);
  return [...new Set(cats)];
}
function announceTape(item) {
  window.dispatchEvent(new CustomEvent("plebflix:tape", { detail: { item, channel: channelId, cat: META.get(channelId)?.cat || "all", cats: categoriesOf(item) } }));
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
  state: () => ({ mode, channelId, spot: currentSpot(), introActive, build: buildStamp, shift: shiftKind }),
  /** Re-read channels/*.json now if a deploy changed them (the librarian's check after a deploy; the deck does it every 5 min). */
  refresh: () => pollBuild(),
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
    if (row.classList.contains("sched__row--now")) return backToLive(); // the programme that is on: join the broadcast
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
    seekTo(spot.start + Math.min(spot.item.duration - 1, Math.max(0, spot.offset + d)), { quiet: true, shuffle: shuffleRun, seek: true });
  });
}

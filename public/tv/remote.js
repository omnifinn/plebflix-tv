/* Plebflix TV remote: a Samsung TV remote (or any D-pad) drives the deck at /tv/.
 *
 * Watching (nothing focused): ▲/▼ and CH+/CH− change channel, ◀/▶ seek 15 s, OK brings up the deck controls.
 * Deck (a control focused): the arrows move focus to the nearest control in that direction, OK presses it,
 * BACK returns to watching. Everywhere: 0-9 tune a channel number, ▶/❚❚/■/◀◀/▶▶ are the transport keys,
 * RED flips International/Suomi, GREEN goes live, YELLOW opens search, BLUE cycles LIVE/LOOP/SHUFFLE.
 * BACK while watching goes back to the launcher page, which closes the app.
 * The Tizen launcher (tizen/index.html) registers the non-mandatory keys before it opens this page.
 */
const KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8,
  CH_UP: 427, CH_DOWN: 428, PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FF: 417, RW: 412,
  NEXT: 10233, PREV: 10232, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, PAGE_UP: 33, PAGE_DOWN: 34,
};
const $ = (id) => document.getElementById(id);
const FOCUSABLE = "button, input, select, a[href], [tabindex]:not([tabindex='-1'])";

function visible(el) {
  if (!el || el.disabled || el.hidden) return false;
  if (el.closest("[hidden], [aria-hidden='true'], .win--eq, .win--fx")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
    // Off-screen controls inside a scroller (the channel strip) still count; the rest do not.
    if (!el.closest("#ch-list, .sched, .search__list")) return false;
  }
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
}

function candidates() {
  return Array.from(document.querySelectorAll(FOCUSABLE)).filter(visible);
}

function centre(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The nearest control in a direction, weighting off-axis distance so a row is preferred over a diagonal jump. */
export function nearest(from, list, dir) {
  const a = from.getBoundingClientRect();
  const ca = centre(a);
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const cb = centre(b);
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    let main;
    let cross;
    if (dir === "left") {
      if (b.right > a.left + 4 && cb.x >= ca.x) continue;
      main = Math.max(0, a.left - b.right);
      cross = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom));
    } else if (dir === "right") {
      if (b.left < a.right - 4 && cb.x <= ca.x) continue;
      main = Math.max(0, b.left - a.right);
      cross = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom));
    } else if (dir === "up") {
      if (b.bottom > a.top + 4 && cb.y >= ca.y) continue;
      main = Math.max(0, a.top - b.bottom);
      cross = Math.max(0, Math.max(b.left - a.right, a.left - b.right));
    } else {
      if (b.top < a.bottom - 4 && cb.y <= ca.y) continue;
      main = Math.max(0, b.top - a.bottom);
      cross = Math.max(0, Math.max(b.left - a.right, a.left - b.right));
    }
    const score = main + cross * 3 + Math.hypot(dx, dy) * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focusEl(el) {
  if (!el) return false;
  el.focus();
  if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(false);
  else el.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function watching() {
  const el = document.activeElement;
  return !el || el === document.body || el === document.documentElement;
}

function click(id) {
  const el = $(id);
  if (el && !el.disabled) el.click();
}

function stepChannel(delta) {
  click(delta > 0 ? "ch-up" : "ch-down");
  flash(document.querySelector("#ch-list [aria-checked='true']")?.textContent || "");
}

let digits = "";
let digitTimer = 0;
function tuneDigit(d) {
  digits = (digits + d).slice(-2);
  flash(`CH ${digits.padStart(2, "0")}`);
  clearTimeout(digitTimer);
  const list = Array.from(document.querySelectorAll("#ch-list [data-ch]"));
  const exact = (n) => list.find((seg) => Number(seg.querySelector(".ch__num")?.textContent) === n);
  const n = Number(digits);
  const longer = list.some((seg) => String(Number(seg.querySelector(".ch__num")?.textContent)).startsWith(digits) && Number(seg.querySelector(".ch__num")?.textContent) !== n);
  const go = () => {
    const seg = exact(Number(digits));
    digits = "";
    if (seg) seg.click();
  };
  if (exact(n) && !longer) go();
  else digitTimer = setTimeout(go, 1200);
}

let flashTimer = 0;
function flash(text) {
  let el = $("tv-flash");
  if (!el) {
    el = document.createElement("div");
    el.id = "tv-flash";
    el.className = "tv-flash lcd-text";
    ($("screen") || document.body).appendChild(el);
  }
  el.textContent = text.replace(/\s+/g, " ").trim();
  el.classList.add("is-on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("is-on"), 1600);
}

function playing() {
  const s = window.plebflix?.state?.();
  return s && (s.mode === "live" || s.mode === "timeshift");
}

function back() {
  const search = $("search-q");
  const list = $("search-list");
  if (document.activeElement === search || (list && !list.hidden)) {
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.blur();
    return;
  }
  const menu = $("skin-menu");
  if (menu && !menu.hidden) {
    click("skin-btn");
    $("skin-btn")?.blur();
    return;
  }
  if (document.querySelector("dialog[open]")) {
    history.back();
    return;
  }
  if (!watching()) {
    document.activeElement.blur();
    return;
  }
  // Watching: leave. The launcher page under this one closes the app when it is shown again.
  if (history.length > 1) history.back();
}

function onKey(event) {
  const code = event.keyCode;
  const target = document.activeElement;
  const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  if (code === KEY.BACK || (code === KEY.ESC && !typing)) {
    handled();
    back();
    return;
  }
  if (code === KEY.CH_UP || code === KEY.PAGE_UP) return handled(), stepChannel(1);
  if (code === KEY.CH_DOWN || code === KEY.PAGE_DOWN) return handled(), stepChannel(-1);
  if (code === KEY.PLAY) return handled(), click("btn-play");
  if (code === KEY.PAUSE) return handled(), click("btn-pause");
  if (code === KEY.PLAY_PAUSE) return handled(), click(playing() ? "btn-pause" : "btn-play");
  if (code === KEY.STOP) return handled(), click("btn-stop");
  if (code === KEY.FF) return handled(), click("btn-fwd");
  if (code === KEY.RW) return handled(), click("btn-rew");
  if (code === KEY.NEXT) return handled(), click("btn-next");
  if (code === KEY.PREV) return handled(), click("btn-prev");
  if (code === KEY.RED) {
    handled();
    const off = document.querySelector("#tv-switch [data-lang][aria-checked='false']");
    if (off) off.click();
    flash(document.querySelector("#tv-switch [aria-checked='true']")?.textContent || "");
    return;
  }
  if (code === KEY.GREEN) return handled(), click("btn-live");
  if (code === KEY.BLUE) return handled(), click("btn-mode");
  if (code === KEY.YELLOW) {
    handled();
    focusEl($("search-q"));
    return;
  }
  if (typing) {
    // The search box keeps its own keys (typing, ▲/▼ through the hits, OK to play one). ▼ with no hits leaves it.
    const list = $("search-list");
    if (code === KEY.DOWN && (!list || list.hidden)) {
      handled();
      target.blur();
      focusEl(nearest(target, candidates(), "down"));
    }
    return;
  }
  if (code >= 48 && code <= 57) return handled(), tuneDigit(String(code - 48));
  const dir = { [KEY.LEFT]: "left", [KEY.RIGHT]: "right", [KEY.UP]: "up", [KEY.DOWN]: "down" }[code];
  if (watching()) {
    if (code === KEY.ENTER) {
      handled();
      focusEl($("btn-pause")?.offsetParent && playing() ? $("btn-pause") : $("btn-play"));
      return;
    }
    if (code === KEY.UP || code === KEY.DOWN) return handled(), stepChannel(code === KEY.UP ? 1 : -1);
    return; // ◀/▶ fall through to the deck's own 15-second nudge
  }
  if (dir) {
    handled();
    const next = nearest(target, candidates(), dir);
    if (next) focusEl(next);
  }
}

window.addEventListener("keydown", onKey, true);
// A remote has no pointer: keep the mouse cursor (the LG/Samsung pointer remote) usable but hidden until it moves.
let pointerTimer = 0;
window.addEventListener("mousemove", () => {
  document.documentElement.classList.add("tv-pointer");
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => document.documentElement.classList.remove("tv-pointer"), 4000);
});
window.plebflixRemote = { nearest, flash, keys: KEY };

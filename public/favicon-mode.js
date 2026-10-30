/** Which favicon state the tab shows (Iris v5): paused wins, then loop, then shuffle, otherwise live.
 * `mode` is the deck state (live/timeshift/paused/stopped); `playMode` is the LIVE/LOOP/SHUFFLE button.
 * A stopped deck (NO SIGNAL) shows the paused icon too, since nothing is playing. */
export function faviconState(mode, playMode) {
  if (mode === "paused" || mode === "stopped") return "paused";
  if (playMode === "loop") return "loop";
  if (playMode === "shuffle") return "shuffle";
  return "live";
}
/** Push the state to favicons/favicon-state.js (a deferred classic script; no-op if it hasn't loaded). */
export function syncFavicon(mode, playMode) {
  const state = faviconState(mode, playMode);
  globalThis.setFaviconState?.(state);
  return state;
}

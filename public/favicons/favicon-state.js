/* Plebflix TV · favicon state swapper (v4)
 * States: 'live' (red rec dot), 'paused' (amber bars), 'shuffle' (cyan crossed arrows), 'loop' (lavender circular arrow).
 * Expects in <head>:
 *   <link id="favicon-svg" rel="icon" type="image/svg+xml" href="/favicons/live/favicon.svg?v=5">
 *   <link id="favicon-png" rel="icon" type="image/png" sizes="32x32" href="/favicons/live/favicon-32.png?v=5">
 *   <link rel="icon" href="/favicon.ico?v=5" sizes="48x48 32x32 16x16">   (static, = live; not swapped)
 */
(function (w, d) {
  var BASE = '/favicons/';
  var VER = '?v=5';
  var STATES = ['live', 'paused', 'shuffle', 'loop'];
  var current = null;

  function link(id, rel, type, sizes) {
    var el = d.getElementById(id);
    if (!el) {
      el = d.createElement('link');
      el.id = id; el.rel = rel; el.type = type;
      if (sizes) el.setAttribute('sizes', sizes);
      d.head.appendChild(el);
    }
    return el;
  }

  // Preload all states so swaps are instant and don't flash.
  STATES.forEach(function (s) {
    var i = new Image(); i.src = BASE + s + '/favicon.svg' + VER;
    var j = new Image(); j.src = BASE + s + '/favicon-32.png' + VER;
  });

  function setFaviconState(state) {
    if (STATES.indexOf(state) === -1) state = 'live';
    if (state === current) return state;
    current = state;
    // Chrome/Firefox only re-read an icon reliably when href changes, which it does here.
    link('favicon-svg', 'icon', 'image/svg+xml').href = BASE + state + '/favicon.svg' + VER;
    link('favicon-png', 'icon', 'image/png', '32x32').href = BASE + state + '/favicon-32.png' + VER;
    d.documentElement.setAttribute('data-player-state', state);
    return state;
  }

  w.setFaviconState = setFaviconState;
  w.getFaviconState = function () { return current; };
})(window, document);

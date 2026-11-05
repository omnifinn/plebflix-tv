(function () {
  'use strict';
  function visible(el) { var r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width && r.height && s.visibility !== 'hidden' && s.display !== 'none'; }
  function candidates() { return Array.prototype.filter.call(document.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]'), visible); }
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode, active = document.activeElement;
    if (code === 10009 || code === 27) { var dialog = document.querySelector('dialog[open]'); if (dialog && dialog.close) dialog.close(); else if (window.tizen) tizen.application.getCurrentApplication().exit(); event.preventDefault(); return; }
    if ([37,38,39,40].indexOf(code) < 0) return;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    var list = candidates(); if (!list.length) return;
    if (!active || list.indexOf(active) < 0) { list[0].focus(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    var a = active.getBoundingClientRect(), ax = a.left + a.width/2, ay = a.top + a.height/2, best = null, score = Infinity;
    list.forEach(function (el) { if (el === active) return; var r = el.getBoundingClientRect(), dx = r.left + r.width/2 - ax, dy = r.top + r.height/2 - ay;
      var main = code === 37 ? -dx : code === 39 ? dx : code === 38 ? -dy : dy;
      var cross = code === 37 || code === 39 ? Math.abs(dy) : Math.abs(dx);
      if (main > 1 && main + cross * 2 < score) { score = main + cross * 2; best = el; }
    });
    if (best) { best.focus(); best.scrollIntoView({block:'nearest'}); }
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener('load', function () { var first = document.querySelector('#tv-switch button'); if (first) first.focus(); });
}());

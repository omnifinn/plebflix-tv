(function () {
  'use strict';
  var items = document.getElementById('items'), status = document.getElementById('status');
  var player = document.getElementById('player'), screen = document.getElementById('screen'), lastFocus;
  function load(channel) {
    status.textContent = 'Loading curated videos…'; items.textContent = '';
    fetch('https://plebflix.com/channels/' + channel + '.json').then(function (r) { if (!r.ok) throw Error('Channel unavailable'); return r.json(); }).catch(function () { return fetch('channels/' + channel + '.json').then(function (r) { if (!r.ok) throw Error('Channel unavailable'); return r.json(); }); }).then(function (data) {
      status.textContent = 'Select a video';
      data.items.forEach(function (tape) {
        var source = (tape.play || []).filter(function (s) { return s.kind === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(s.id_or_url); })[0];
        var archive = (tape.play || []).filter(function (s) { return s.kind === 'archive' && /^[A-Za-z0-9_.-]+$/.test(s.id_or_url) && s.file && !/(^|\/)\.\.(\/|$)/.test(s.file); })[0];
        if (!source && !archive) return;
        var button = document.createElement('button'), img = document.createElement('img'), label = document.createElement('span');
        if (source) img.src = 'https://i.ytimg.com/vi/' + source.id_or_url + '/hqdefault.jpg';
        img.alt = ''; label.textContent = tape.title; button.appendChild(img); button.appendChild(label);
        button.onclick = function () { lastFocus = button; document.getElementById('title').textContent = tape.title; screen.textContent = ''; var media;
          if (source) { media = document.createElement('iframe'); media.src = 'https://www.youtube-nocookie.com/embed/' + source.id_or_url; media.allow = 'autoplay; encrypted-media; fullscreen'; media.allowFullscreen = true; }
          else { media = document.createElement('video'); media.controls = true; media.autoplay = true; media.src = 'https://archive.org/download/' + encodeURIComponent(archive.id_or_url) + '/' + archive.file.split('/').map(encodeURIComponent).join('/'); }
          screen.appendChild(media); player.hidden = false; document.getElementById('back').focus(); };
        items.appendChild(button);
      });
    }).catch(function () { status.textContent = 'Could not load this channel.'; });
  }
  function back() { if (!player.hidden) { player.hidden = true; screen.textContent = ''; if (lastFocus) lastFocus.focus(); } }
  document.getElementById('back').onclick = back;
  document.getElementById('international').onclick = function () { load('international'); };
  document.getElementById('suomi').onclick = function () { load('suomi'); };
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 10009 || e.keyCode === 27) { if (!player.hidden) { e.preventDefault(); back(); } return; }
    var dx = e.keyCode === 37 ? -1 : e.keyCode === 39 ? 1 : 0, dy = e.keyCode === 38 ? -1 : e.keyCode === 40 ? 1 : 0;
    if (!dx && !dy) return;
    var buttons = Array.prototype.slice.call(document.querySelectorAll(player.hidden ? 'nav button, main button' : '#player button'));
    var index = buttons.indexOf(document.activeElement); if (index < 0) index = 0;
    var next = Math.max(0, Math.min(buttons.length - 1, index + (dy ? dy * (index < 2 ? 1 : 4) : dx)));
    if (buttons[next]) { e.preventDefault(); buttons[next].focus(); }
  });
  load('international'); document.getElementById('international').focus();
}());

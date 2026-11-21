(function () {
  var player, pending, token;
  function send(type, value) { window.parent.postMessage({source: 'plebflix-yt', type: type, value: value, token: token}, '*'); }
  function load(data) {
    token = data.token;
    if (!window.YT || !YT.Player) { pending = data; return; }
    if (player) { player.destroy(); player = null; }
    var node = document.createElement('div'); node.id = 'yt-player';
    var root = document.getElementById('player'); root.innerHTML = ''; root.appendChild(node);
    player = new YT.Player('yt-player', {
      width: '100%', height: '100%', videoId: data.id,
      playerVars: {autoplay: 1, controls: 0, playsinline: 1, start: Math.max(0, Math.floor(data.start || 0)), origin: 'https://plebflix.com'},
      events: {
        onReady: function (e) { if (data.muted) e.target.mute(); e.target.playVideo(); },
        onStateChange: function (e) { send('state', e.data); },
        onError: function (e) { send('error', e.data); }
      }
    });
  }
  window.onYouTubeIframeAPIReady = function () { if (pending) { var p = pending; pending = null; load(p); } send('ready'); };
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || e.data.target !== 'plebflix-yt') return;
    var data = e.data;
    if (data.command === 'load' && /^[A-Za-z0-9_-]{1,32}$/.test(data.id)) load(data);
    else if (player && data.token === token) {
      if (data.command === 'play') player.playVideo();
      if (data.command === 'pause') player.pauseVideo();
      if (data.command === 'mute') player.mute();
    }
  });
  send('shim-ready');
})();

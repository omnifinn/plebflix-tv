import { buildBroadcast, liveSeconds, spotAt, resolveDefinition, dayKey } from "../public/schedule.js";
import { sources, archiveFile } from "../public/play.js";
(function() {
  const $ = (id) => document.getElementById(id), video = $("video"), panel = $("panel"), banner = $("banner");
  let clockSkew = 0;
  const now = () => Date.now() + clockSkew;
  let data = window.SNAPSHOT, stats = {}, lang = "international", index = 0, overlay = "", selection = 0, query = "", digits = "", digitTimer, hideTimer, watchdog, endTimer, generation = 0, yt = null, ytState = -1, current = null, shift = 0, started = 0;
  let programmeDay = "", programmeCache = {}, guideLang = lang, startOffset = 0, recent = [];
  const keys = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "SPACE", "DELETE", "CLEAR"];
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function channels(language = lang) {
    return data.index.channels.filter((c) => c.lang === language && data.docs[c.id]);
  }
  function channel() {
    return channels()[index] || channels()[0];
  }
  function programme(c) {
    const day = dayKey(now());
    if (programmeDay !== day) { programmeDay = day; programmeCache = {}; }
    if (!programmeCache[c.id]) {
      const doc = Object.assign({}, data.docs[c.id], { number: c.number, name: c.name });
      programmeCache[c.id] = buildBroadcast(doc, now(), stats[c.lang] || {}, resolveDefinition(data.schedule, c.id));
    }
    return programmeCache[c.id];
  }
  function spot(c) {
    let p = programme(c);
    return spotAt(p, liveSeconds(p, now()) + shift);
  }
  function localTime(ms) {
    const date = new Date(ms);
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }
  function broadcast(c) {
    const list = programme(c);
    const currentSpot = spotAt(list, liveSeconds(list, now()) + (c.id === channel().id ? shift : 0));
    return { list, spot: currentSpot, next: currentSpot && list[(currentSpot.index + 1) % list.length] };
  }
  function setLanguage(value) {
    lang = value;
    document.body.dataset.language = lang;
    const suffix = lang === "suomi" ? "suomi" : "intl";
    $("ident").src = "brand/ident-" + suffix + ".svg";
    $("ident").alt = "Plebflix " + (lang === "suomi" ? "Suomi" : "International");
  }
  function signal(mode) {
    $("signal").className = mode;
    $("signal-label").textContent = mode === "no-signal" ? "NO SIGNAL · NEXT TAPE" : "TUNING IN";
  }
  function bannerMarkup() {
    const c = channel(), schedule = broadcast(c), s = schedule.spot;
    const item = current || (s && s.item) || {};
    const elapsed = s && s.item.id === item.id ? s.offset : Math.max(0, startOffset + (Date.now() - started) / 1000);
    const percent = item.duration ? Math.max(0, Math.min(100, elapsed * 100 / item.duration)) : 0;
    const remaining = Math.max(0, (item.duration || 0) - elapsed);
    const suffix = lang === "suomi" ? "suomi" : "intl";
    return '<div class="channel-number"><small>CH</small>' + String(c.number).padStart(2, "0") + '</div>' +
      '<div class="osd"><div class="osd-top"><img src="brand/wordmark-' + suffix + '.svg" alt="Plebflix"><span>THE HUMAN INTERNET · 24/7</span></div>' +
      '<div class="lcd"><div class="lcd-head"><span>' + esc(c.name) + ' &nbsp; / &nbsp; ' + (lang === "suomi" ? "SUOMI" : "INTL") + '</span><span class="live"><i class="led"></i>LIVE</span></div>' +
      '<div class="osd-title">' + esc(item.title) + (item.year ? ' ★ ' + esc(item.year) : '') + ' ★ NOW PLAYING</div>' +
      '<div class="progress-line"><span>ON AIR</span><div class="progress"><span style="width:' + percent + '%"></span></div><span>−' + Math.ceil(remaining / 60) + ' MIN</span></div>' +
      '<div class="next">UP NEXT &nbsp; ' + esc(schedule.next && schedule.next.title) + '</div></div></div>';
  }
  function showBanner() {
    banner.innerHTML = bannerMarkup();
    banner.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => banner.hidden = true, 5e3);
  }
  function stop() {
    clearTimeout(watchdog);
    clearTimeout(endTimer);
    video.onplaying = video.onerror = video.onloadedmetadata = video.onended = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (yt) {
      yt = null;
    }
    $("youtube").innerHTML = "";
    $("youtube").style.display = "none";
  }
  function tune() {
    let c = channel();
    if (!c) return;
    let s = spot(c);
    if (!s) return;
    current = s.item;
    start(s.item, s.offset);
    showBanner();
  }
  function start(item, offset) {
    generation++;
    let g = generation;
    stop();
    started = Date.now();
    startOffset = offset;
    $("boot").hidden = true;
    signal("tuning");
    let list = sources(item).filter((x) => x.kind === "youtube" || x.kind === "archive" || x.kind === "wayback");
    let at = 0, attempt = 0;
    function next() {
      if (g !== generation) return;
      let a = ++attempt;
      clearTimeout(watchdog);
      video.onplaying = video.onerror = video.onloadedmetadata = video.onended = null;
      if (yt) {
        yt = null;
      }
      $("youtube").innerHTML = "";
      $("youtube").style.display = "none";
      video.pause();
      video.removeAttribute("src");
      video.load();
      let source = list[at++];
      if (!source) {
        signal("no-signal");
        watchdog = setTimeout(() => {
          shift += Math.max(1, item.duration - offset);
          tune();
        }, 3e3);
        return;
      }
      console.log("TV source " + source.kind + " " + item.id);
      watchdog = setTimeout(next, source.kind === "youtube" ? 1e4 : 8e3);
      function playing() {
        if (g !== generation || a !== attempt) return;
        clearTimeout(watchdog);
        signal("");
        console.log("TV first-playing " + source.kind + " " + item.id + " " + (Date.now() - started) + "ms");
      }
      if (source.kind === "youtube") {
        $("youtube").style.display = "block";
        let frame = document.createElement("iframe");
        frame.src = "https://plebflix.com/tv/yt";
        frame.width = "1920";
        frame.height = "1080";
        frame.allow = "autoplay; encrypted-media";
        frame.setAttribute("frameborder", "0");
        $("youtube").appendChild(frame);
        yt = { frame, token: g, source, offset, playing, next };
      } else {
        video.onplaying = playing;
        video.onerror = () => {
          if (a === attempt) next();
        };
        video.onended = () => {
          shift = 0;
          tune();
        };
        video.onloadedmetadata = () => {
          try {
            video.currentTime = offset;
          } catch (e) {
          }
        };
        video.src = archiveFile(source);
        video.play().catch(() => {
          if (g === generation && a === attempt) next();
        });
      }
    }
    next();
    endTimer = setTimeout(() => {
      shift = 0;
      tune();
    }, Math.max(1e3, Math.min((item.duration - offset) * 1e3, 864e5 - now() % 864e5)));
  }
  function move(delta) {
    let cs = channels();
    index = (index + delta + cs.length) % cs.length;
    shift = 0;
    overlay = "";
    panel.hidden = true;
    tune();
  }
  function open(type) {
    overlay = type;
    guideLang = lang;
    selection = type === "guide" ? index : 0;
    panel.hidden = false;
    render();
  }
  function close() {
    overlay = "";
    panel.hidden = true;
  }
  function results() {
    const seen = {};
    const items = (data.docs[lang].items || []).filter((x) => {
      if (seen[x.id] || (query && x.title.toLowerCase().indexOf(query.toLowerCase()) < 0)) return false;
      seen[x.id] = true;
      return true;
    });
    if (!query) {
      const ranks = {};
      items.forEach((item, i) => ranks[item.id] = i);
      items.sort((a, b) => {
        const ai = recent.indexOf(a.id), bi = recent.indexOf(b.id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        const scores = stats[lang] || {};
        return (Number(scores[b.id] && scores[b.id].impressions) || 0) - (Number(scores[a.id] && scores[a.id].impressions) || 0) || ranks[a.id] - ranks[b.id];
      });
    }
    return items.slice(0, 6);
  }
  function hintStrip() {
    return '<footer class="window-footer"><span><i class="dot red"></i>TV</span><span><i class="dot green"></i>GUIDE</span><span><i class="dot yellow"></i>SEARCH</span><span><i class="dot blue"></i>INFO</span><span>ARROWS MOVE &nbsp; OK SELECT &nbsp; BACK CLOSE</span></footer>';
  }
  function windowFrame(title, content) {
    const activeLang = overlay === "guide" ? guideLang : lang;
    const suffix = activeLang === "suomi" ? "suomi" : "intl";
    return '<header class="window-top"><img src="brand/wordmark-' + suffix + '.svg" alt="Plebflix"><span>' + title + ' &nbsp; / &nbsp; ' + (activeLang === "suomi" ? "SUOMI" : "INTL") + '</span><span>● LIVE</span></header>' +
      '<section class="window-body">' + content + '</section>' + hintStrip();
  }
  function homeChannel(item) {
    const hit = channels().find((c) => c.number !== 1 && (data.docs[c.id].items || []).some((x) => x.id === item.id));
    return hit ? "CH " + hit.number + " · " + hit.name : "CH 1 · " + channel().name;
  }
  function render() {
    panel.dataset.language = overlay === "guide" ? guideLang : lang;
    if (overlay === "guide") {
      const cs = channels(guideLang), start2 = Math.max(0, Math.min(selection - 3, cs.length - 7));
      const rows = cs.slice(start2, start2 + 7).map((c, i) => {
        const p = programme(c), s = spotAt(p, liveSeconds(p, now()));
        const next = s && p[(s.index + 1) % p.length];
        const startTime = s ? now() - s.offset * 1000 : now();
        return '<div class="guide-row ' + (i + start2 === selection ? "selected" : "") + '">' +
          '<div class="channel-cell">' + String(c.number).padStart(2, "0") + ' &nbsp;' + esc(c.short || c.name) + '</div>' +
          '<div class="programme-cell"><small>' + localTime(startTime) + '</small>' + esc(s && s.item.title) + '</div>' +
          '<div class="programme-cell"><small>' + localTime(startTime + (s ? s.item.duration * 1000 : 0)) + '</small>' + esc(next && next.title) + '</div></div>';
      }).join("");
      panel.innerHTML = windowFrame("CHANNEL GUIDE", '<h1>CHANNEL GUIDE</h1><p class="subline">LIVE BROADCAST &nbsp; / &nbsp; LOCAL TIME &nbsp; / &nbsp; ◀ ▶ SWITCH TV</p><div class="guide-head"><span>CHANNEL</span><span>NOW</span><span>NEXT</span></div>' + rows);
    } else if (overlay === "search") {
      const r = results();
      const keyboard = keys.map((k, i) => '<div class="key ' + (selection === i ? "selected" : "") + '">' + esc(k) + '</div>').join("");
      const rows = r.map((x, i) => '<div class="result-row ' + (selection === keys.length + i ? "selected" : "") + '"><span>' + esc(x.title) + '</span><small>' + esc(x.year || "") + ' &nbsp; ' + esc(homeChannel(x)) + '</small></div>').join("");
      panel.innerHTML = windowFrame("SEARCH", '<h1>SEARCH THE TAPES</h1><div class="query">' + esc(query || "TYPE A TITLE_") + '</div><div class="keyboard">' + keyboard + '</div><div class="result-title">' + (query ? "RESULTS" : "RECENT & POPULAR") + '</div><div class="results">' + rows + '</div>');
    } else {
      const c = channel(), source = current && sources(current)[0];
      panel.innerHTML = windowFrame("TAPE INFO", '<h1>NOW PLAYING</h1><div class="info-title">' + esc(current && current.title) + '</div>' +
        '<div class="info-row"><span class="info-label">YEAR</span><span>' + esc(current && current.year || "UNKNOWN") + '</span></div>' +
        '<div class="info-row"><span class="info-label">CHANNEL</span><span>CH ' + c.number + ' · ' + esc(c.name) + '</span></div>' +
        '<div class="info-row"><span class="info-label">SOURCE</span><span>' + esc(source && source.kind || "UNKNOWN") + ' · ' + esc(source && source.uploader || current && current.credit || "") + '</span></div>' +
        '<div class="info-row"><span class="info-label">STATION</span><span>' + esc(c.tagline || data.docs[c.id].tagline || "") + '</span></div>');
    }
  }
  function input(n) {
    digits += n;
    clearTimeout(digitTimer);
    digitTimer = setTimeout(() => {
      let i = channels().findIndex((c) => c.number === Number(digits));
      digits = "";
      if (i >= 0) {
        index = i;
        shift = 0;
        close();
        tune();
      }
    }, 900);
  }
  function handle(e) {
    let k = e.keyCode;
    if (k >= 48 && k <= 57) {
      input(k - 48);
      e.preventDefault();
      return;
    }
    if (k === 10009 || k === 27 || k === 8) {
      if (overlay) close();
      else if (window.tizen) tizen.application.getCurrentApplication().exit();
      e.preventDefault();
      return;
    }
    if (k === 403) {
      setLanguage(lang === "international" ? "suomi" : "international");
      index = 0;
      shift = 0;
      close();
      tune();
    } else if (k === 404) open("guide");
    else if (k === 405) open("search");
    else if (k === 406) open("info");
    else if (k === 427) move(1);
    else if (k === 428) move(-1);
    else if (overlay === "guide") {
      if (k === 38) selection = (selection + channels(guideLang).length - 1) % channels(guideLang).length;
      else if (k === 40) selection = (selection + 1) % channels(guideLang).length;
      else if (k === 37 || k === 39) {
        guideLang = guideLang === "international" ? "suomi" : "international";
        selection = Math.min(selection, channels(guideLang).length - 1);
      }
      else if (k === 13) {
        setLanguage(guideLang);
        index = selection;
        shift = 0;
        close();
        tune();
        return;
      }
      render();
    } else if (overlay === "search") {
      let max = keys.length + results().length;
      if (k === 37) selection = Math.max(0, selection - 1);
      else if (k === 39) selection = Math.min(max - 1, selection + 1);
      else if (k === 38) selection = Math.max(0, selection - 10);
      else if (k === 40) selection = Math.min(max - 1, selection + 10);
      else if (k === 13) {
        if (selection < keys.length) {
          let key = keys[selection];
          query = key === "CLEAR" ? "" : key === "DELETE" ? query.slice(0, -1) : query + (key === "SPACE" ? " " : key);
        } else {
          let item = results()[selection - keys.length];
          if (item) {
            recent = [item.id].concat(recent.filter((id) => id !== item.id)).slice(0, 10);
            try { localStorage.setItem("tv-recent", JSON.stringify(recent)); } catch (e) {}
            close();
            current = item;
            start(item, 0);
            showBanner();
            return;
          }
        }
      }
      render();
    } else if (k === 38) move(1);
    else if (k === 40) move(-1);
    else if (k === 13) showBanner();
    else if (k === 10252) {
      if (yt) {
        if (ytState === 1) ytSend("pause");
        else ytSend("play");
      } else if (video.paused) video.play();
      else video.pause();
    } else if (k === 415) {
      if (yt) ytSend("play");
      else video.play();
    } else if (k === pauseCode()) {
      video.pause();
      if (yt) ytSend("pause");
    } else if (k === 413) {
      video.pause();
      if (yt) ytSend("pause");
    } else if (k === 412 || k === 417 || k === 37 || k === 39) {
      shift += k === 412 || k === 37 ? -15 : 15;
      tune();
    } else return;
    e.preventDefault();
  }
  function pauseCode() {
    return 19;
  }
  function get(path) {
    return fetch("https://plebflix.com" + path).then((r) => {
      if (!r.ok) throw Error(r.status);
      let server = Date.parse(r.headers.get("date") || "");
      if (server) {
        let skew = server + 500 - Date.now();
        clockSkew = Math.abs(skew) > 3e3 ? skew : 0;
      }
      return r.json();
    });
  }
  function refresh() {
    let day = dayKey(now());
    Promise.all([get("/channels/index.json"), get("/channels/schedule.json"), get("/api/stats?channel=international&day=" + day), get("/api/stats?channel=suomi&day=" + day)]).then((all) => Promise.all(all[0].channels.map((c) => get("/channels/" + c.id + ".json"))).then((docs) => {
      let map = {};
      all[0].channels.forEach((c, i) => map[c.id] = docs[i]);
      let newStats = { international: all[2].items || {}, suomi: all[3].items || {} };
      let changed = data.index.build !== all[0].build || JSON.stringify(stats) !== JSON.stringify(newStats);
      data = { index: all[0], schedule: all[1], docs: map };
      stats = newStats;
      if (changed) programmeCache = {};
      try {
        localStorage.setItem("tv-cache", JSON.stringify({ data, stats, day }));
      } catch (e) {
      }
      index = Math.min(index, channels().length - 1);
      if (changed) tune();
    })).catch((e) => console.log("TV refresh failed " + e));
  }
  try {
    const saved = JSON.parse(localStorage.getItem("tv-recent") || "[]");
    if (Array.isArray(saved)) recent = saved.filter((id) => typeof id === "string").slice(0, 10);
    let cache = JSON.parse(localStorage.getItem("tv-cache"));
    if (cache && cache.data) {
      data = cache.data;
      if (cache.day === dayKey(now())) stats = cache.stats;
    }
  } catch (e) {
  }
  try {
    ["ChannelUp", "ChannelDown", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue", "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaRewind", "MediaFastForward", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach((k) => {
      try {
        tizen.tvinputdevice.registerKey(k);
      } catch (e) {
      }
    });
  } catch (e) {
    console.log("TV register " + e);
  }
  function ytSend(command) {
    if (!yt) return;
    yt.frame.contentWindow.postMessage({ target: "plebflix-yt", command, token: yt.token, id: yt.source.id, start: yt.offset }, "https://plebflix.com");
  }
  window.addEventListener("message", (e) => {
    if (!yt || e.origin !== "https://plebflix.com" || e.source !== yt.frame.contentWindow || !e.data || e.data.source !== "plebflix-yt") return;
    if (e.data.type === "shim-ready") {
      ytSend("load");
      return;
    }
    if (e.data.token !== yt.token) return;
    if (e.data.type === "state") {
      ytState = e.data.value;
      if (ytState === 1) yt.playing();
      else if (ytState === 0) tune();
    } else if (e.data.type === "error") {
      console.log("TV YouTube error " + e.data.value);
      yt.next();
    }
  });
  document.addEventListener("keydown", handle);
  setLanguage(lang);
  tune();
  refresh();
  setInterval(() => {
    if (!banner.hidden) banner.innerHTML = bannerMarkup();
  }, 1000);
  setInterval(refresh, 3e5);
})();

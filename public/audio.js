/* Plebflix TV — 10-band graphic equalizer + visualizer for the self-hosted tapes.
   WebAudio: <video> → preamp → 10 peaking BiquadFilters → analyser → speakers.
   Drawn from scratch in the spirit of late-90s desktop players. Settings persist in localStorage. */
const KEY = "plebflix-aeq";
export const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const LABELS = ["60", "170", "310", "600", "1K", "3K", "6K", "12K", "14K", "16K"];
export const PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock: [5, 3, -3, -5, -2, 2, 5, 7, 7, 7],
  Pop: [-1, 3, 5, 5, 3, 0, -1, -1, -1, -1],
  Dance: [6, 5, 2, 0, 0, -3, -4, -4, 0, 0],
  Techno: [5, 4, 0, -3, -3, 0, 5, 6, 6, 5],
  Club: [0, 0, 4, 3, 3, 3, 2, 0, 0, 0],
  Live: [-3, 0, 2, 3, 3, 3, 2, 1, 1, 1],
  "Bass boost": [8, 7, 5, 2, 0, 0, 0, 0, 0, 0],
  "Treble boost": [0, 0, 0, 0, 0, 2, 5, 7, 8, 8],
  "Voice / talk": [-4, -3, 0, 3, 5, 5, 3, 0, -2, -3],
  "VHS mono": [-6, -2, 2, 4, 4, 2, -2, -6, -9, -12],
  "Laptop speakers": [4, 6, 3, -2, -1, 1, 4, 6, 7, 7],
};
/** AUTO: pick a curve from the tape's category channels. */
const AUTO = { mtv: "Pop", asiaa: "Voice / talk", dokkarit: "Voice / talk", visailut: "Voice / talk", komedia: "Voice / talk", memes: "Flat", gaming: "Techno", animaatio: "Club" };
const MODES = ["bars", "scope", "off"];

const $ = (id) => document.getElementById(id);
const vid = $("vid");
const defaults = () => ({ on: true, auto: false, preset: "Flat", pre: 0, g: [...PRESETS.Flat], view: "eq", vis: "bars" });
let state = load();
let ctx = null;
let pre = null;
let filters = [];
let analyser = null;
let raf = 0;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.g) && s.g.length === 10) return { ...defaults(), ...s };
  } catch {
    /* fresh */
  }
  return defaults();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

const SAME_ORIGIN_MEDIA = false;

/** Build the graph on the first user gesture (an AudioContext made earlier would start suspended and mute the tape). */
function ensureGraph() {
  // Every file now comes from archive.org, whose CDN sends no CORS header. A cross-origin file routed through Web Audio
  // comes out silent, so the deck's sound stays on the element and the bands stay picture only.
  if (ctx || !vid || !SAME_ORIGIN_MEDIA) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    const src = ctx.createMediaElementSource(vid);
    pre = ctx.createGain();
    filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    let node = src.connect(pre);
    for (const b of filters) node = node.connect(b);
    node.connect(analyser).connect(ctx.destination);
    applyGains();
  } catch {
    ctx = null;
  }
  return ctx;
}
function resume() {
  ensureGraph();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}
for (const type of ["pointerdown", "keydown", "touchend"]) addEventListener(type, resume, { passive: true });
vid?.addEventListener("play", () => ctx && ctx.state === "suspended" && ctx.resume().catch(() => {}));

function applyGains() {
  if (!ctx) return;
  const t = ctx.currentTime;
  pre.gain.setTargetAtTime(state.on ? Math.pow(10, state.pre / 20) : 1, t, 0.02);
  filters.forEach((b, i) => b.gain.setTargetAtTime(state.on ? state.g[i] : 0, t, 0.02));
}

function render() {
  $("aeq-on").setAttribute("aria-pressed", String(state.on));
  $("aeq-on").classList.toggle("is-lit", state.on);
  $("aeq-auto").setAttribute("aria-pressed", String(state.auto));
  $("aeq-auto").classList.toggle("is-lit", state.auto);
  $("aeq-preset").value = PRESETS[state.preset] ? state.preset : "";
  $("aeq-pre").value = String(state.pre);
  state.g.forEach((v, i) => ($(`aeq-b${i}`).value = String(v)));
  const win = $("eqwin");
  win.dataset.view = state.view;
  $("aeq-view").textContent = state.view === "eq" ? "VIS" : "EQ";
  $("aeq-view").setAttribute("aria-pressed", String(state.view === "vis"));
  $("aeq-vis-well").hidden = state.view !== "vis";
  $("aeq-bands").hidden = state.view !== "eq";
  $("aeq-mode").textContent = state.vis.toUpperCase();
  if (state.view === "vis" && state.vis !== "off") startVis();
  else stopVis();
}
function setPreset(name) {
  if (!PRESETS[name]) return;
  state.preset = name;
  state.g = [...PRESETS[name]];
  applyGains();
  render();
  save();
}

function build() {
  const sel = $("aeq-preset");
  sel.innerHTML = `<option value="" disabled>Custom</option>` + Object.keys(PRESETS).map((n) => `<option>${n}</option>`).join("");
  const slider = (id, label, min, max, title) =>
    `<label class="fader aeq__fader" title="${title}"><input class="fader__range" type="range" id="${id}" min="${min}" max="${max}" step="1" aria-label="${title}"><span class="fader__lbl">${label}</span></label>`;
  $("aeq-bands").innerHTML =
    slider("aeq-pre", "PRE", -12, 12, "Preamp (dB)") + `<span class="aeq__gap" aria-hidden="true"></span>` + BANDS.map((f, i) => slider(`aeq-b${i}`, LABELS[i], -12, 12, `${LABELS[i]}Hz (dB)`)).join("");
  $("aeq-pre").addEventListener("input", (e) => {
    state.pre = Number(e.target.value);
    applyGains();
    save();
  });
  BANDS.forEach((_, i) => {
    const input = $(`aeq-b${i}`);
    input.addEventListener("input", () => {
      state.g[i] = Number(input.value);
      state.preset = Object.keys(PRESETS).find((n) => PRESETS[n].every((v, j) => v === state.g[j])) || "";
      state.auto = false;
      if (!state.on) state.on = true;
      applyGains();
      render();
      save();
    });
    input.addEventListener("dblclick", () => {
      state.g[i] = 0;
      applyGains();
      render();
      save();
    });
  });
  sel.addEventListener("change", () => {
    state.auto = false;
    setPreset(sel.value);
  });
  $("aeq-on").addEventListener("click", () => {
    state.on = !state.on;
    applyGains();
    render();
    save();
  });
  $("aeq-auto").addEventListener("click", () => {
    state.auto = !state.auto;
    render();
    save();
    if (state.auto) autoPick(lastTape);
  });
  $("aeq-view").addEventListener("click", () => {
    state.view = state.view === "eq" ? "vis" : "eq";
    render();
    save();
  });
  $("aeq-vis").addEventListener("click", () => {
    state.vis = MODES[(MODES.indexOf(state.vis) + 1) % MODES.length];
    render();
    save();
  });
  render();
}

let lastTape = null;
function autoPick(detail) {
  if (!state.auto || !detail?.item) return;
  // Category ids come from the deck (`cat` = the channel on now, `cats` = every category that carries the tape).
  const cats = [detail.cat, ...(detail.cats || []), detail.channel, ...(detail.item.channels || [])];
  const hit = cats.map((c) => AUTO[c]).find(Boolean) || "Flat";
  if (hit !== state.preset) setPreset(hit);
}
addEventListener("plebflix:tape", (e) => {
  lastTape = e.detail;
  autoPick(e.detail);
});

/* ── visualizer ── */
const canvas = $("aeq-vis");
const g2 = canvas?.getContext("2d");
let peaks = [];
function css(name, fallback) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}
function startVis() {
  if (raf || !g2) return;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio || 300);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio || 64);
    g2.fillStyle = css("--vis-bg", "#05140a");
    g2.fillRect(0, 0, w, h);
    const ink = css("--vis-ink", "#7CFF6B");
    const hot = css("--vis-hot", "#FFB547");
    const live = analyser && ctx && ctx.state === "running" && !vid.paused && !vid.hidden;
    if (state.vis === "bars") {
      const n = 28;
      const bw = w / n;
      const data = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
      if (live) analyser.getByteFrequencyData(data);
      for (let i = 0; i < n; i += 1) {
        // log-spaced bins so bass doesn't hog the display
        const lo = Math.floor(Math.pow(data.length || 1, i / n));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(data.length || 1, (i + 1) / n)));
        let v = 0;
        for (let j = lo; j < hi && j < data.length; j += 1) v = Math.max(v, data[j]);
        const bh = live ? (v / 255) * h : (0.06 + 0.04 * Math.sin(Date.now() / 400 + i)) * h;
        const segs = Math.round(bh / (3 * devicePixelRatio));
        for (let s = 0; s < segs; s += 1) {
          g2.fillStyle = s > (h / (3 * devicePixelRatio)) * 0.75 ? hot : ink;
          g2.fillRect(i * bw + 1, h - (s + 1) * 3 * devicePixelRatio, bw - 2, 2 * devicePixelRatio);
        }
        peaks[i] = Math.max((peaks[i] || 0) - 0.6 * devicePixelRatio, bh);
        g2.fillStyle = "#fff";
        g2.fillRect(i * bw + 1, h - peaks[i] - 2, bw - 2, devicePixelRatio);
      }
    } else if (state.vis === "scope") {
      const data = new Uint8Array(analyser ? analyser.fftSize : 0);
      if (live) analyser.getByteTimeDomainData(data);
      g2.strokeStyle = ink;
      g2.lineWidth = 1.5 * devicePixelRatio;
      g2.beginPath();
      const step = Math.max(1, Math.floor(data.length / w));
      for (let x = 0; x < w; x += 1) {
        const v = live ? data[x * step] / 128 - 1 : 0;
        const y = h / 2 + v * (h / 2) * 0.9;
        if (x) g2.lineTo(x, y);
        else g2.moveTo(x, y);
      }
      g2.stroke();
    }
  };
  draw();
}
function stopVis() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (g2) {
    g2.fillStyle = "#05140a";
    g2.fillRect(0, 0, canvas.width, canvas.height);
  }
}

window.plebAudio = { state: () => ({ ...state, graph: Boolean(ctx && analyser), ctxState: ctx?.state, bands: filters.length }), analyser: () => analyser, setPreset };
build();

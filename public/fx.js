/* Plebflix TV — EQ window as a picture-effects desk.
   Faders drive CSS filters / overlays on the CRT stage (works over self-hosted video and embeds);
   The audio equalizer and visualizer live in audio.js. Settings persist in localStorage. */
const KEY = "plebflix-fx";
const FADERS = [
  { id: "bri", label: "BRI", min: 50, max: 150, def: 100 },
  { id: "con", label: "CON", min: 50, max: 160, def: 100 },
  { id: "sat", label: "SAT", min: 0, max: 220, def: 100 },
  { id: "hue", label: "HUE", min: -180, max: 180, def: 0 },
  { id: "sep", label: "SEP", min: 0, max: 100, def: 0 },
  { id: "soft", label: "SOFT", min: 0, max: 30, def: 0 },
  { id: "grn", label: "GRN", min: 0, max: 100, def: 0 },
  { id: "scn", label: "SCN", min: 0, max: 100, def: 55 },
];
const TOGGLES = [
  { id: "vhs", label: "VHS" },
  { id: "track", label: "TRACK" },
  { id: "chroma", label: "CHROMA" },
  { id: "bw", label: "B&W" },
  { id: "sepia", label: "SEPIA" },
  { id: "grain", label: "GRAIN" },
  { id: "curve", label: "CRT" },
  { id: "invert", label: "NEG" },
  { id: "mirror", label: "MIRROR" },
];
const defaults = () => ({ on: true, f: Object.fromEntries(FADERS.map((f) => [f.id, f.def])), t: {} });

let state = load();
const $ = (id) => document.getElementById(id);
const glass = $("screen");
const stage = $("stage");
const grain = $("fx-grain");
const gctx = grain?.getContext("2d", { alpha: true });
let grainTimer = 0;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") {
      const base = defaults();
      return { on: saved.on !== false, f: { ...base.f, ...(saved.f || {}) }, t: { ...(saved.t || {}) } };
    }
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

function apply() {
  const f = state.f;
  const t = state.on ? state.t : {};
  const on = state.on;
  const parts = [];
  if (on) {
    if (f.bri !== 100) parts.push(`brightness(${f.bri}%)`);
    if (f.con !== 100) parts.push(`contrast(${f.con}%)`);
    if (f.sat !== 100) parts.push(`saturate(${f.sat}%)`);
    if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
    const sep = Math.max(f.sep, t.sepia ? 85 : 0);
    if (sep) parts.push(`sepia(${sep}%)`);
    if (f.soft) parts.push(`blur(${(f.soft / 20).toFixed(2)}px)`);
    if (t.bw) parts.push("grayscale(100%) contrast(115%)");
    if (t.invert) parts.push("invert(100%)");
    if (t.chroma) parts.push("url(#fx-chroma)");
    if (t.vhs) parts.push("saturate(130%) contrast(108%)");
  }
  stage.style.filter = parts.join(" ");
  const cls = glass.classList;
  for (const tog of TOGGLES) cls.toggle(`fx-${tog.id}`, Boolean(on && t[tog.id]));
  glass.style.setProperty("--fx-scan", String(on ? f.scn / 100 : 0.55));
  const grainLevel = on ? Math.max(f.grn / 250, t.grain ? 0.2 : 0, t.vhs ? 0.1 : 0) : 0;
  glass.style.setProperty("--fx-grain", String(grainLevel));
  if (grainLevel > 0 && !grainTimer && !matchMedia("(prefers-reduced-motion: reduce)").matches) grainTimer = setInterval(drawGrain, 70);
  if (grainLevel <= 0 && grainTimer) {
    clearInterval(grainTimer);
    grainTimer = 0;
    gctx?.clearRect(0, 0, grain.width, grain.height);
  }
  // UI sync
  for (const fd of FADERS) {
    const input = $(`fx-${fd.id}`);
    if (input && Number(input.value) !== f[fd.id]) input.value = String(f[fd.id]);
  }
  for (const tog of TOGGLES) $(`fx-t-${tog.id}`)?.setAttribute("aria-pressed", String(Boolean(state.t[tog.id])));
  const onKey = $("fx-on");
  onKey.classList.toggle("is-lit", state.on);
  onKey.setAttribute("aria-pressed", String(state.on));
  $("fxwin").dataset.fx = state.on ? "on" : "off";
}

function drawGrain() {
  if (!gctx) return;
  const { width, height } = grain;
  const img = gctx.createImageData(width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  gctx.putImageData(img, 0, 0);
}

function build() {
  $("faders").innerHTML = FADERS.map(
    (fd) =>
      `<label class="fader" title="${fd.label}"><input class="fader__range" type="range" id="fx-${fd.id}" min="${fd.min}" max="${fd.max}" step="1" value="${state.f[fd.id]}" aria-label="${fd.label}"><span class="fader__lbl">${fd.label}</span></label>`,
  ).join("");
  for (const fd of FADERS) {
    const input = $(`fx-${fd.id}`);
    input.addEventListener("input", () => {
      state.f[fd.id] = Number(input.value);
      if (!state.on) state.on = true;
      apply();
      save();
    });
    input.addEventListener("dblclick", () => {
      state.f[fd.id] = fd.def;
      apply();
      save();
    });
  }
  $("fx-toggles").innerHTML = TOGGLES.map((tog) => `<button type="button" class="fx__chip" id="fx-t-${tog.id}" aria-pressed="false">${tog.label}</button>`).join("");
  for (const tog of TOGGLES) {
    $(`fx-t-${tog.id}`).addEventListener("click", () => {
      state.t[tog.id] = !state.t[tog.id];
      if (!state.on) state.on = true;
      apply();
      save();
    });
  }
  $("fx-on").addEventListener("click", () => {
    state.on = !state.on;
    apply();
    save();
  });
  $("fx-reset").addEventListener("click", () => {
    state = defaults();
    apply();
    save();
  });
  $("fx-rnd").addEventListener("click", () => {
    const pick = TOGGLES.filter(() => Math.random() < 0.3);
    state.t = Object.fromEntries(pick.map((tog) => [tog.id, true]));
    if (!pick.length) state.t[TOGGLES[(Math.random() * TOGGLES.length) | 0].id] = true;
    state.f.hue = Math.random() < 0.25 ? Math.round(Math.random() * 120 - 60) : 0;
    state.f.sat = Math.round(70 + Math.random() * 80);
    state.f.con = Math.round(95 + Math.random() * 25);
    state.on = true;
    apply();
    save();
  });
  apply();
}

build();

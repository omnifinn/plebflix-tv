/* Tactile controls: a short synthesised mechanical click (WebAudio, no samples) and a press animation
   on every button. On by default at a low volume; the CLICK key mutes it (remembered in localStorage). */
const KEY = "plebflix-click";
let on = true;
try {
  on = localStorage.getItem(KEY) !== "off";
} catch {
  /* ignore */
}
let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
/** A 25 ms filtered noise burst plus a tiny pitched tick: a switch, not a beep. */
export function click(strength = 1) {
  if (!on) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const len = Math.floor(ac.sampleRate * 0.025);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2600 + Math.random() * 600;
  band.Q.value = 1.2;
  const gain = ac.createGain();
  gain.gain.value = 0.09 * strength;
  noise.connect(band).connect(gain).connect(ac.destination);
  const tick = ac.createOscillator();
  tick.type = "square";
  tick.frequency.setValueAtTime(1800, t);
  tick.frequency.exponentialRampToValueAtTime(600, t + 0.012);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.025 * strength, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
  tick.connect(tg).connect(ac.destination);
  noise.start(t);
  tick.start(t);
  tick.stop(t + 0.02);
}
const PRESSABLE = "button, [role='button'], [role='radio'], .sched__row, summary, select";
function press(el) {
  el.classList.remove("is-pressing");
  void el.offsetWidth;
  el.classList.add("is-pressing");
  setTimeout(() => el.classList.remove("is-pressing"), 160);
}
document.addEventListener("pointerdown", (event) => {
  const el = event.target.closest?.(PRESSABLE);
  if (!el || el.disabled) return;
  press(el);
  click();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const el = event.target.closest?.(PRESSABLE);
  if (!el) return;
  press(el);
  click(0.8);
}, true);
function paint() {
  const b = document.getElementById("click-toggle");
  if (!b) return;
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "CLICK ON" : "CLICK OFF";
  b.title = on ? "Button click sound on (click to mute)" : "Button click sound off";
}
document.getElementById("click-toggle")?.addEventListener("click", () => {
  on = !on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  paint();
  if (on) click();
});
paint();
window.plebTactile = { click, get on() { return on; } };

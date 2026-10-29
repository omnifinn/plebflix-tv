/* Plebflix TV — skins menu. Original late-90s-inspired themes; Iris's PLEBAMP stays the default. */
const KEY = "plebflix-skin";
export const SKINS = [
  { id: "plebamp", name: "PLEBAMP (Iris, default)" },
  { id: "steel", name: "Classic Steel" },
  { id: "neon", name: "Neon LCD" },
  { id: "glass", name: "Translucent Blue" },
  { id: "wood", name: "Wood Grain" },
];
const $ = (id) => document.getElementById(id);
function apply(id) {
  const skin = SKINS.find((s) => s.id === id) ? id : "plebamp";
  if (skin === "plebamp") delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = skin;
  for (const li of document.querySelectorAll("#skin-menu [data-skin]")) li.setAttribute("aria-checked", String(li.dataset.skin === skin));
  return skin;
}
let current = "plebamp";
try {
  current = localStorage.getItem(KEY) || "plebamp";
} catch {
  /* default */
}
const btn = $("skin-btn");
const menu = $("skin-menu");
menu.innerHTML = SKINS.map((s) => `<li role="menuitemradio" tabindex="-1" data-skin="${s.id}" aria-checked="false"><span class="skins__sw skins__sw--${s.id}" aria-hidden="true"></span>${s.name}</li>`).join("");
current = apply(current);
const open = (on) => {
  menu.hidden = !on;
  btn.setAttribute("aria-expanded", String(on));
  if (on) menu.querySelector(`[data-skin="${current}"]`)?.focus();
};
btn.addEventListener("click", (e) => {
  e.stopPropagation();
  open(menu.hidden);
});
const choose = (li) => {
  if (!li) return;
  current = apply(li.dataset.skin);
  try {
    localStorage.setItem(KEY, current);
  } catch {
    /* private mode */
  }
  open(false);
  btn.focus();
};
menu.addEventListener("click", (e) => choose(e.target.closest("[data-skin]")));
menu.addEventListener("keydown", (e) => {
  e.stopPropagation();
  const items = [...menu.querySelectorAll("[data-skin]")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    choose(document.activeElement);
  } else if (e.key === "Escape") open(false);
});
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest?.(".skins")) open(false);
});
window.plebSkins = { set: (id) => choose({ dataset: { skin: id } }), get: () => current };

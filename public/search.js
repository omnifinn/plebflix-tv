/* Plebflix TV — type-ahead tape search. Fuzzy over title, year, channel names and tags;
   folds Finnish letters (ä→a, ö→o, å→a) and forgives typos. Picking a hit plays it. */
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/** Optimal-string-alignment distance, capped for speed. */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}
function wordScore(q, words) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if (w.startsWith(q)) best = Math.max(best, 0.9 - Math.min(0.2, (w.length - q.length) * 0.01));
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 0.7);
    else if (q.length >= 3) {
      const cap = q.length <= 4 ? 1 : 2;
      const d = editDistance(q, w.slice(0, q.length + 1), cap);
      const d2 = editDistance(q, w, cap);
      const dd = Math.min(d, d2);
      if (dd <= cap) best = Math.max(best, 0.62 - dd * 0.14);
    }
  }
  return best;
}
export function buildIndex(catalog) {
  const byId = new Map();
  for (const ch of catalog) {
    for (const item of ch.items || []) {
      if (item.kind === "ident" || !(item.duration > 0)) continue;
      let entry = byId.get(item.id);
      if (!entry) {
        entry = { item, chans: new Set(), names: new Set() };
        byId.set(item.id, entry);
      }
      entry.chans.add(ch.id);
      entry.names.add(ch.name || ch.id);
    }
  }
  return [...byId.values()].map((e) => {
    const title = fold(e.item.title);
    const meta = fold([...e.names, ...(e.item.tags || []), e.item.id.replace(/-/g, " ")].join(" "));
    return { ...e, title, titleWords: title.split(" "), metaWords: meta.split(" "), year: String(e.item.year ?? "") };
  });
}
export function search(index, raw, limit = 8) {
  const q = fold(raw);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);
  const out = [];
  for (const e of index) {
    let score = 0;
    let all = true;
    for (const t of terms) {
      let s = 0;
      if (/^\d{4}$/.test(t)) s = e.year === t ? 1 : 0;
      else if (/^\d{2,3}$/.test(t)) s = e.year.startsWith(t) ? 0.6 : wordScore(t, e.titleWords) * 0.8;
      else s = Math.max(wordScore(t, e.titleWords), wordScore(t, e.metaWords) * 0.75);
      if (s <= 0) all = false;
      score += s;
    }
    if (!all && terms.length > 1) score *= 0.5;
    if (e.title.startsWith(q)) score += 0.5;
    if (score > 0.3) out.push({ e, score: score / terms.length + (e.title.includes(q) ? 0.2 : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.e.item.title.length - b.e.item.title.length || a.e.item.title.localeCompare(b.e.item.title));
  return out.slice(0, limit).map((r) => ({ item: r.e.item, chans: [...r.e.chans], score: +r.score.toFixed(3) }));
}

if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const input = $("search-q");
  const list = $("search-list");
  let index = null;
  let hits = [];
  let active = -1;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ensure = () => {
    if (!index && window.plebflix?.catalog) {
      const cat = window.plebflix.catalog();
      if (cat.some((c) => c.items.length)) index = buildIndex(cat);
    }
    return index;
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };
  const paint = () => {
    if (!hits.length) {
      list.innerHTML = input.value.trim() ? `<li class="search__none">No tape like that — REC it?</li>` : "";
      list.hidden = !input.value.trim();
      return;
    }
    list.innerHTML = hits
      .map(
        (h, i) =>
          `<li role="option" id="sr-${i}" class="search__hit${i === active ? " is-active" : ""}" aria-selected="${i === active}" data-id="${esc(h.item.id)}"><span class="search__t">${esc(h.item.title)}</span><span class="search__y">${esc(h.item.year)}</span><span class="search__c">${esc(h.chans.slice(0, 2).join(" · ").toUpperCase())}</span></li>`,
      )
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `sr-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const pick = (id) => {
    if (!id) return;
    window.plebflix?.playTape(id);
    input.value = "";
    hits = [];
    close();
    input.blur();
  };
  input.addEventListener("input", () => {
    if (!ensure()) return;
    hits = search(index, input.value);
    active = hits.length ? 0 : -1;
    paint();
  });
  input.addEventListener("focus", () => ensure() && input.value && paint());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[Math.max(0, active)]?.item.id);
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".search__hit");
    if (!li) return;
    e.preventDefault();
    pick(li.dataset.id);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest?.("#search")) close();
  });
}

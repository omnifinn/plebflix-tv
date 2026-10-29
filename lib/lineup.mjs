/**
 * Channel model: channel × language. Channels are universal categories (channels/categories.json);
 * the language (International / Suomi) is a separate TV switch. CH 1 on each TV is "all tapes"
 * (the language doc itself, id = the language), then the categories, numbered the same on both TVs.
 */
export const LANGS = ["international", "suomi"];

const pick = (v, lang) => (v && typeof v === "object" ? v[lang] ?? v.international : v);

export function buildLineup(docs, categories) {
  const all = categories.all || {};
  const langs = LANGS.map((id) => ({ id, name: id === "suomi" ? "Suomi" : "International", short: id === "suomi" ? "SUOMI" : "INTL" }));
  const index = [];
  const cats = {};
  for (const lang of LANGS) {
    index.push({ id: lang, lang, cat: "all", number: 1, name: pick(all.name, lang) || docs[lang].name, short: pick(all.short, lang) || "ALL", tagline: pick(all.tagline, lang) || docs[lang].tagline, kind: "all", count: (docs[lang].items || []).length });
    const byId = new Map((docs[lang].items || []).map((item) => [item.id, { ...item, home: lang }]));
    let number = 2;
    for (const ch of categories.channels || []) {
      const items = [];
      for (const [id, list] of Object.entries(categories.assign || {})) if (list.includes(ch.id) && byId.has(id)) items.push(byId.get(id));
      const n = number++;
      if (!items.length) continue;
      const id = `${lang}-${ch.id}`;
      const doc = { id, lang, cat: ch.id, number: n, name: pick(ch.name, lang), short: pick(ch.short, lang), tagline: pick(ch.tagline, lang), kind: "category", items };
      cats[id] = doc;
      index.push({ id, lang, cat: ch.id, number: n, name: doc.name, short: doc.short, tagline: doc.tagline, kind: "category", count: items.length });
    }
  }
  return { langs, index, cats };
}

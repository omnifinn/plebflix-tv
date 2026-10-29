import { wilsonLower } from "../public/schedule.js";
import { renderResources } from "./resources-md.mjs";
import { validateChannel } from "./schema.mjs";

/** Calibration tapes stay on the shelf even when the room dislikes them. */
export const PROTECTED = new Set([
  "b5mies",
  "kahen-kilon-siika",
  "ismo-seppo-pyorailee",
  "numa-numa",
  "leeroy-jenkins",
]);

export const MIN_VOTES = 12;
export const DROP_WILSON = 0.32;
export const MIN_SHELF = 25;
export const TOP_VOTES = 8;

/**
 * @param {{ id: string, items: Array<Record<string, any>> }} channel
 * @param {Record<string, { up?: number, down?: number, wilson?: number, impressions?: number }>} stats
 */
export function curateChannel(channel, stats = {}) {
  const live = channel.items.filter((item) => item.status !== "pending" && item.duration > 0);
  const flagged = [];
  for (const item of live) {
    const row = stats[item.id];
    if (!row) continue;
    const up = Number(row.up) || 0;
    const down = Number(row.down) || 0;
    const votes = up + down;
    const wilson = Number.isFinite(row.wilson) ? Number(row.wilson) : wilsonLower(up, down);
    if (votes >= MIN_VOTES && wilson < DROP_WILSON) {
      flagged.push({
        id: item.id,
        title: item.title,
        year: item.year,
        wilson,
        votes,
        up,
        down,
        protected: PROTECTED.has(item.id),
      });
    }
  }
  flagged.sort((a, b) => a.wilson - b.wilson || b.votes - a.votes);
  const room = Math.max(0, live.length - MIN_SHELF);
  const drops = [];
  const held = [];
  let used = 0;
  for (const row of flagged) {
    if (row.protected) {
      held.push({ ...row, reason: "calibration tape" });
      continue;
    }
    if (used >= room) {
      held.push({ ...row, reason: `shelf would fall under ${MIN_SHELF}` });
      continue;
    }
    drops.push(row);
    used += 1;
  }
  const tops = live
    .map((item) => {
      const row = stats[item.id];
      if (!row) return null;
      const up = Number(row.up) || 0;
      const down = Number(row.down) || 0;
      const votes = up + down;
      if (votes < TOP_VOTES) return null;
      return {
        id: item.id,
        title: item.title,
        year: item.year,
        creator: item.creator || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        signals: Array.isArray(item.signals) ? item.signals : [],
        wilson: Number.isFinite(row.wilson) ? Number(row.wilson) : wilsonLower(up, down),
        votes,
        up,
        down,
        impressions: Number(row.impressions) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.wilson - a.wilson || b.votes - a.votes)
    .slice(0, 12);
  return { live: live.length, drops, held, tops, groups: groupTops(tops) };
}

/** @param {Array<{ year: number, creator: string, tags: string[], signals: string[], title: string }>} tops */
export function groupTops(tops) {
  /** @type {Record<string, string[]>} */
  const eras = {};
  /** @type {Record<string, string[]>} */
  const tags = {};
  /** @type {Record<string, string[]>} */
  const creators = {};
  /** @type {Record<string, string[]>} */
  const signals = {};
  const signalNames = {
    a: "born online",
    b: "spread widely",
    c: "still quoted",
    d: "amateur or DIY",
    e: "defined its scene",
  };
  for (const item of tops) {
    const era = `${Math.floor(Number(item.year) / 10) * 10}s`;
    (eras[era] ||= []).push(item.title);
    if (item.creator) (creators[item.creator] ||= []).push(item.title);
    for (const tag of item.tags) (tags[tag] ||= []).push(item.title);
    for (const signal of item.signals) {
      const label = signalNames[signal] || signal;
      (signals[label] ||= []).push(item.title);
    }
  }
  return { eras, tags, creators, signals };
}

/**
 * @param {Array<{ id: string, name: string, items: any[] }>} channels
 * @param {Record<string, Record<string, any>>} statsByChannel
 * @param {{ day?: string, note?: string }} [meta]
 */
export function renderReport(channels, statsByChannel, meta = {}) {
  const lines = [
    "# Curation report",
    "",
    meta.day ? `Snapshot day: ${meta.day} (votes and plays from before that UTC midnight).` : "Snapshot day: unknown.",
    "",
    `A tape is flagged when it has at least ${MIN_VOTES} votes and a Wilson lower bound under ${DROP_WILSON}.`,
    "Calibration tapes stay. A channel is not taken under 25 playable tapes.",
    "",
  ];
  if (meta.note) lines.push(meta.note, "");
  const plans = [];
  for (const channel of channels) {
    const plan = curateChannel(channel, statsByChannel[channel.id] || {});
    plans.push({ channel, plan });
    lines.push(`## ${channel.name} (${channel.id})`, "", `Playable tapes: ${plan.live}.`, "");
    lines.push("### Drop", "");
    if (!plan.drops.length) lines.push("Nothing to pull.", "");
    else {
      for (const row of plan.drops) {
        lines.push(
          `- ${row.title} (\`${row.id}\`, ${row.year}) — wilson ${row.wilson.toFixed(3)}, ${row.up} up / ${row.down} down`,
        );
      }
      lines.push("");
    }
    if (plan.held.length) {
      lines.push("### Held back", "");
      for (const row of plan.held) {
        lines.push(`- ${row.title} (\`${row.id}\`) — ${row.reason}, wilson ${row.wilson.toFixed(3)}`);
      }
      lines.push("");
    }
    lines.push("### Find more like these", "");
    if (!plan.tops.length) {
      lines.push("No tape has enough votes to point at yet.", "");
      continue;
    }
    for (const row of plan.tops) {
      const bits = [`wilson ${row.wilson.toFixed(3)}`, `${row.votes} votes`, String(row.year)];
      if (row.creator) bits.push(row.creator);
      if (row.tags.length) bits.push(row.tags.join(", "));
      lines.push(`- ${row.title} — ${bits.join("; ")}`);
    }
    lines.push("");
    lines.push(...section("Eras", plan.groups.eras));
    lines.push(...section("Creators", plan.groups.creators));
    lines.push(...section("Tags", plan.groups.tags));
    lines.push(...section("Signals", plan.groups.signals));
  }
  return { text: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`, plans };
}

/** @param {string} title @param {Record<string, string[]>} groups */
function section(title, groups) {
  const keys = Object.keys(groups);
  if (!keys.length) return [];
  return [`#### ${title}`, "", ...keys.sort().map((key) => `- ${key}: ${groups[key].join("; ")}`), ""];
}

/**
 * Remove flagged ids from copies of the channel documents and rebuild the library page.
 * @param {Array<{ id: string, items: any[] }>} docs
 * @param {Array<{ channel: { id: string }, plan: { drops: Array<{ id: string }> } }>} plans
 */
export function applyDrops(docs, plans) {
  const next = docs.map((doc) => ({ ...doc, items: doc.items.slice() }));
  const removed = [];
  for (const { channel, plan } of plans) {
    const doc = next.find((entry) => entry.id === channel.id);
    if (!doc) continue;
    const ids = new Set(plan.drops.map((row) => row.id));
    if (!ids.size) continue;
    const gone = doc.items.filter((item) => ids.has(item.id)).map((item) => item.id);
    doc.items = doc.items.filter((item) => !ids.has(item.id));
    removed.push(...gone);
    const check = validateChannel(doc, doc.id);
    if (!check.ok) {
      throw new Error(check.errors.join("; "));
    }
  }
  return { docs: next, resources: renderResources(next), removed };
}

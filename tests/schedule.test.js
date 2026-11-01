import assert from "node:assert/strict";
import test from "node:test";
import {
  airWeight,
  buildBroadcast,
  dayKey,
  identFor,
  wilsonLower,
} from "../public/schedule.js";

function shelf(count, duration = 30) {
  return {
    id: "international",
    number: 2,
    name: "International",
    items: Array.from({ length: count }, (_, index) => ({
      id: `clip-${index}`,
      duration,
      year: 2006,
    })),
  };
}

test("a UTC day and a vote snapshot build one broadcast", () => {
  const channel = shelf(12);
  const at = Date.UTC(2024, 0, 2, 15, 30, 0);
  const stats = { "clip-1": { up: 3, down: 1, impressions: 4 } };
  const first = buildBroadcast(channel, at, stats).map((item) => item.id);
  const second = buildBroadcast(channel, at + 60 * 60 * 1000, stats).map((item) => item.id);
  assert.deepEqual(first, second);
  assert.equal(dayKey(at), "2024-01-02");
  assert.notEqual(dayKey(at), dayKey(Date.UTC(2024, 0, 3)));
});

test("two UTC days do not share a lineup", () => {
  const channel = shelf(16, 45);
  const monday = buildBroadcast(channel, Date.UTC(2024, 0, 1)).map((item) => item.id).join(",");
  const friday = buildBroadcast(channel, Date.UTC(2024, 0, 5)).map((item) => item.id).join(",");
  assert.notEqual(monday, friday);
});

test("a station ident sits between clips", () => {
  const broadcast = buildBroadcast(shelf(6, 120), Date.UTC(2024, 3, 1));
  assert.ok(broadcast.length >= 4);
  assert.equal(broadcast.length % 2, 0);
  for (let index = 0; index < broadcast.length; index += 2) {
    assert.notEqual(broadcast[index].kind, "ident");
    assert.equal(broadcast[index + 1].kind, "ident");
    assert.equal(broadcast[index + 1].duration, 8);
    assert.equal(broadcast[index + 1].source, "ident");
  }
  const card = identFor({ id: "suomi", number: 1, name: "Suomi" }, 0);
  assert.equal(card.title, "Suomi");
  assert.equal(card.line, "Plebflix — real human slop");
});

test("a clip does not return inside six hours when the shelf is long enough", () => {
  const channel = shelf(8, 3600);
  const broadcast = buildBroadcast(channel, Date.UTC(2024, 6, 4, 8));
  const seen = new Set();
  let cursor = 0;
  for (const entry of broadcast) {
    if (entry.kind !== "ident") {
      assert.equal(seen.has(entry.id), false, entry.id);
      seen.add(entry.id);
    }
    cursor += entry.duration;
    if (cursor >= 6 * 60 * 60) break;
  }
  assert.ok(seen.size >= 5);
});

test("a liked tape outweighs a disliked one across the month", () => {
  const channel = shelf(10, 20);
  channel.items.push({ id: "loved", duration: 20, year: 2012 });
  channel.items.push({ id: "hated", duration: 20, year: 2012 });
  const stats = {
    loved: { up: 40, down: 1, impressions: 50 },
    hated: { up: 1, down: 40, impressions: 50 },
  };
  let loved = 0;
  let hated = 0;
  for (let day = 1; day <= 28; day += 1) {
    for (const entry of buildBroadcast(channel, Date.UTC(2024, 2, day), stats)) {
      if (entry.id === "loved") loved += 1;
      if (entry.id === "hated") hated += 1;
    }
  }
  assert.ok(loved > hated, `loved ${loved} hated ${hated}`);
});

test("wilson lower bound and air weight", () => {
  assert.equal(wilsonLower(0, 0), 0.5);
  assert.ok(wilsonLower(20, 0) > 0.8);
  assert.ok(wilsonLower(0, 20) < 0.2);
  const fresh = airWeight({ year: 2001 }, { up: 0, down: 0, impressions: 0 });
  const known = airWeight({ year: 2014 }, { up: 1, down: 20, impressions: 30 });
  const liked = airWeight({ year: 2014 }, { up: 20, down: 1, impressions: 30 });
  assert.ok(fresh > 1);
  assert.ok(liked > known);
});

test("the live clock starts the day's lineup at 00:00 UTC and is the same on every device", async () => {
  const { liveSeconds: live, dayStartSeconds } = await import("../public/schedule.js");
  const items = [{ duration: 100 }, { duration: 100 }];
  const midnight = Date.UTC(2026, 9, 30);
  assert.equal(dayStartSeconds(midnight + 5 * 3600 * 1000), midnight / 1000);
  assert.equal(live(items, midnight), 0);
  assert.equal(live(items, midnight + 10_000), 10);
  assert.equal(live(items, midnight + 250_000), 50);
  assert.equal(live(items, midnight - 1000), 199); // the last second of the day before
  assert.equal(live([], midnight), 0);
});

test("a tape added today airs from tomorrow, on every device", async () => {
  const { liveItems } = await import("../public/schedule.js");
  const channel = shelf(4, 60);
  channel.items.push({ id: "fresh", duration: 60, year: 2005, added: "2026-10-30" });
  channel.items.push({ id: "old", duration: 60, year: 2005, added: "2026-10-01" });
  const today = Date.UTC(2026, 9, 30, 15);
  const tomorrow = Date.UTC(2026, 9, 31, 0, 0, 1);
  assert.equal(liveItems(channel, today).some((item) => item.id === "fresh"), false);
  assert.equal(liveItems(channel, today).some((item) => item.id === "old"), true);
  assert.equal(liveItems(channel, tomorrow).some((item) => item.id === "fresh"), true);
  assert.equal(buildBroadcast(channel, today).some((item) => item.id === "fresh"), false);
  assert.equal(buildBroadcast(channel, tomorrow).some((item) => item.id === "fresh"), true);
});

test("schedule definitions: defaults, the TV's block, a channel's own block, bad values ignored", async () => {
  const { resolveDefinition, DEFAULT_DEFINITION, slotSeconds } = await import("../public/schedule.js");
  assert.deepEqual(resolveDefinition(null, "suomi"), { ...DEFAULT_DEFINITION, slots: [] });
  const doc = {
    defaults: { hold_out_hours: 4, ident_seconds: 5 },
    channels: {
      suomi: { slots: [{ at: "19:00", tape: "b5mies" }, { at: "07:30", tape: "siika" }, { at: "25:00", tape: "nope" }, { at: "08:00" }] },
      "suomi-komedia": { order: "catalog", hold_out_hours: 99, ident_seconds: 0 },
    },
  };
  const suomi = resolveDefinition(doc, "suomi");
  assert.equal(suomi.hold_out_hours, 4);
  assert.equal(suomi.ident_seconds, 5);
  assert.deepEqual(suomi.slots, [{ at: 7.5 * 3600, tape: "siika" }, { at: 19 * 3600, tape: "b5mies" }]);
  const memes = resolveDefinition(doc, "suomi-memes"); // no block of its own → the Suomi TV's block
  assert.deepEqual(memes.slots, suomi.slots);
  const komedia = resolveDefinition(doc, "suomi-komedia");
  assert.equal(komedia.order, "catalog");
  assert.equal(komedia.hold_out_hours, 4, "out of range → the defaults layer");
  assert.equal(komedia.ident_seconds, 5);
  assert.deepEqual(komedia.slots, [], "own block without slots → none (not the TV's)");
  assert.equal(slotSeconds("00:00"), 0);
  assert.equal(slotSeconds("23:59"), 86340);
  assert.ok(Number.isNaN(slotSeconds("24:00")));
  assert.ok(Number.isNaN(slotSeconds("7:00")));
});

test("a fixed slot lands at its second and the gap before it is filled with clips that fit", async () => {
  const { resolveDefinition } = await import("../public/schedule.js");
  const channel = shelf(10, 150);
  channel.items.push({ id: "anchor", duration: 400, year: 2004 });
  const def = resolveDefinition({ channels: { international: { slots: [{ at: "06:00", tape: "anchor" }, { at: "18:00", tape: "anchor" }] } } }, "international");
  const broadcast = buildBroadcast(channel, Date.UTC(2026, 9, 30), {}, def);
  let at = 0;
  const starts = [];
  for (const entry of broadcast) {
    if (entry.id === "anchor") starts.push(at);
    at += entry.duration;
  }
  assert.ok(starts.includes(6 * 3600), `anchor starts ${starts.join(",")}`);
  assert.ok(starts.includes(18 * 3600), `anchor starts ${starts.join(",")}`);
  assert.ok(at >= 24 * 3600);
  // Nothing in the lineup straddles a slot: every entry ends at or before a slot start or begins at/after it.
  at = 0;
  for (const entry of broadcast) {
    for (const slotAt of [6 * 3600, 18 * 3600]) assert.ok(at + entry.duration <= slotAt || at >= slotAt, `${entry.id} at ${at} straddles ${slotAt}`);
    at += entry.duration;
  }
});

test("a slot whose tape does not fit the gap is carried by a longer ident, never skipped", async () => {
  const { resolveDefinition } = await import("../public/schedule.js");
  const channel = shelf(3, 1000); // every clip is longer than most gaps
  channel.items.push({ id: "anchor", duration: 30, year: 2004 });
  const def = resolveDefinition({ channels: { international: { slots: [{ at: "00:10", tape: "anchor" }] } } }, "international");
  const broadcast = buildBroadcast(channel, Date.UTC(2026, 9, 30), {}, def);
  let at = 0;
  let landed = false;
  for (const entry of broadcast) {
    if (entry.id === "anchor" && at === 600) landed = true;
    at += entry.duration;
  }
  assert.equal(landed, true);
});

test("order: catalog plays the file order round and round, the same every day", async () => {
  const { resolveDefinition } = await import("../public/schedule.js");
  const channel = shelf(5, 3600);
  const def = resolveDefinition({ channels: { international: { order: "catalog" } } }, "international");
  const monday = buildBroadcast(channel, Date.UTC(2026, 9, 26), {}, def).filter((e) => e.kind !== "ident").map((e) => e.id);
  const friday = buildBroadcast(channel, Date.UTC(2026, 9, 30), {}, def).filter((e) => e.kind !== "ident").map((e) => e.id);
  assert.deepEqual(monday, friday);
  assert.deepEqual(monday.slice(0, 6), ["clip-0", "clip-1", "clip-2", "clip-3", "clip-4", "clip-0"]);
});

test("the checked-in schedule.json resolves for every channel and keeps the lineup a day long", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolveDefinition, totalDuration } = await import("../public/schedule.js");
  const { buildLineup } = await import("../lib/lineup.mjs");
  const read = async (f) => JSON.parse(await readFile(f, "utf8"));
  const doc = await read("channels/schedule.json");
  const docs = { suomi: await read("channels/suomi.json"), international: await read("channels/international.json") };
  const lineup = buildLineup(docs, await read("channels/categories.json"));
  const all = { suomi: { ...docs.suomi, id: "suomi" }, international: { ...docs.international, id: "international" }, ...lineup.cats };
  for (const [id, channel] of Object.entries(all)) {
    const def = resolveDefinition(doc, id);
    const broadcast = buildBroadcast(channel, Date.UTC(2026, 9, 30), {}, def);
    assert.ok(totalDuration(broadcast) >= 24 * 3600, `${id} covers the day`);
  }
});

test("idents: false airs clips back to back, and a slot gap is still landed", async () => {
  const { resolveDefinition } = await import("../public/schedule.js");
  const channel = { id: "suomi", number: 1, name: "Suomi", items: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, duration: 60 + i })) };
  const day = Date.UTC(2026, 9, 26);
  const plain = buildBroadcast(channel, day, {}, resolveDefinition({ defaults: { idents: false } }, "suomi"));
  assert.equal(plain.filter((entry) => entry.kind === "ident").length, 0);
  assert.ok(plain.reduce((sum, entry) => sum + entry.duration, 0) >= 86400);
  const slot = buildBroadcast(channel, day, {}, resolveDefinition({ defaults: { idents: false, slots: [{ at: "12:00", tape: "t3" }] } }, "suomi"));
  let at = 0;
  let landed = false;
  for (const entry of slot) {
    if (entry.id === "t3" && at === 43200) landed = true;
    at += entry.duration;
  }
  assert.equal(landed, true);
});

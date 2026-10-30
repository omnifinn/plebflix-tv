import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { classicCutoff, validateChannel, validateSources } from "../lib/schema.mjs";

const sample = () => ({
  id: "suomi",
  number: 1,
  name: "Suomi",
  tagline: "Test",
  items: [
    {
      id: "sandstorm",
      title: "Sandstorm",
      year: 1999,
      source: "youtube",
      embedId: "y6120QOlsfU",
      duration: 233,
      note: "A loop.",
      credit: "https://www.youtube.com/watch?v=y6120QOlsfU",
      signals: ["b", "c", "e"],
      why: "The track still defines a loading-screen scene.",
      original_url: "https://www.youtube.com/watch?v=y6120QOlsfU",
    },
  ],
});

test("a playable channel passes", () => {
  assert.equal(validateChannel(sample(), "suomi").ok, true);
});

test("pending tapes may have a zero duration", () => {
  const doc = sample();
  doc.items.push({
    id: "suggestion-ab12cd",
    title: "Something",
    year: 2004,
    source: "youtube",
    embedId: "dQw4w9WgXcQ",
    duration: 0,
    note: "",
    credit: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    signals: ["b", "c", "e"],
    why: "The bait-and-switch is still the joke.",
    original_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    status: "pending",
  });
  assert.equal(validateChannel(doc, "suomi").ok, true);
});

test("live tapes need a duration and unique embeds", () => {
  const doc = sample();
  doc.items[0].duration = 0;
  const zero = validateChannel(doc, "suomi");
  assert.equal(zero.ok, false);
  doc.items[0].duration = 10;
  doc.items.push({ ...doc.items[0], id: "other" });
  const dup = validateChannel(doc, "suomi");
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((error) => error.includes("duplicated")));
});

test("a classic has to be old enough and carry three signals", () => {
  const cutoff = classicCutoff();
  const doc = sample();
  doc.items[0].year = cutoff + 1;
  const young = validateChannel(doc, "suomi");
  assert.equal(young.ok, false);
  assert.ok(young.errors.some((error) => error.includes(String(cutoff))));
  doc.items[0].year = cutoff;
  doc.items[0].signals = ["a", "b"];
  const thin = validateChannel(doc, "suomi");
  assert.equal(thin.ok, false);
  assert.ok(thin.errors.some((error) => error.includes("signals")));
});

test("sources.json lists real shelves", async () => {
  const doc = JSON.parse(await readFile("sources.json", "utf8"));
  const result = validateSources(doc);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
  const hosts = doc.shelves.flatMap((shelf) => shelf.hosts);
  assert.ok(hosts.includes("web.archive.org"));
  assert.ok(hosts.includes("archive.org"));
});

test("checked-in channels validate", async () => {
  const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && name !== "categories.json" && name !== "schedule.json");
  assert.ok(files.includes("suomi.json"));
  assert.ok(files.includes("international.json"));
  for (const name of files) {
    const doc = JSON.parse(await readFile(`channels/${name}`, "utf8"));
    const result = validateChannel(doc, name.replace(/\.json$/, ""));
    assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
    const live = doc.items.filter((item) => item.status !== "pending");
    assert.ok(live.length >= 25, `${name} has ${live.length} playable items`);
  }
  const suomi = JSON.parse(await readFile("channels/suomi.json", "utf8"));
  const b5 = suomi.items.find((item) => item.id === "b5mies");
  assert.equal(b5.embedId, "f-lnF5eNFFY");
  assert.equal(b5.year, 1999);
  assert.deepEqual(b5.signals, ["a", "c", "d", "e"]);
  const intl = JSON.parse(await readFile("channels/international.json", "utf8"));
  const numa = intl.items.find((item) => item.id === "numa-numa");
  assert.equal(numa.embedId, "Cqd1Gvq-RBY");
  assert.equal(numa.source, "youtube");
  assert.match(numa.original_url, /web\.archive\.org\/web\/20041211162602/);
  const leeroy = intl.items.find((item) => item.id === "leeroy-jenkins");
  assert.equal(leeroy.embedId, "mLyOj_QD4a4");
  assert.equal(leeroy.year, 2005);
  assert.ok(leeroy.signals.length >= 3);
});

test("added must be a real UTC day; media and media_source are shaped", () => {
  const doc = sample();
  doc.items[0].added = "2026-10-30";
  doc.items[0].media = "/media/suomi/sandstorm.mp4";
  doc.items[0].media_source = "https://archive.org/download/x/y.mp4";
  assert.equal(validateChannel(doc, "suomi").ok, true);
  doc.items[0].added = "2026-13-01";
  assert.equal(validateChannel(doc, "suomi").ok, false);
  doc.items[0].added = "yesterday";
  assert.equal(validateChannel(doc, "suomi").ok, false);
  doc.items[0].added = "2026-10-30";
  doc.items[0].media = "media/suomi/sandstorm.mp4";
  assert.match(validateChannel(doc, "suomi").errors.join("\n"), /media must look like/);
});

test("schedule.json: slots must name a tape on the shelf, at distinct UTC minutes, with room before the next", async () => {
  const { validateSchedule } = await import("../lib/schema.mjs");
  const catalogs = { suomi: sample(), international: { ...sample(), id: "international", items: [{ ...sample().items[0], id: "numa", title: "Numa", duration: 120 }] } };
  const categories = { channels: [{ id: "mtv", short: "MTV", name: "Music" }, { id: "komedia", short: "COMEDY", name: "Comedy" }], assign: { sandstorm: ["mtv"], numa: ["mtv"] } };
  assert.equal(validateSchedule({ defaults: { order: "seeded", hold_out_hours: 6, ident_seconds: 8, slots: [] }, channels: {} }, catalogs, categories).ok, true);
  const good = { channels: { suomi: { slots: [{ at: "19:00", tape: "sandstorm" }] }, "international-mtv": { order: "catalog", slots: [{ at: "06:00", tape: "numa" }] } } };
  assert.equal(validateSchedule(good, catalogs, categories).ok, true);
  const errors = (doc) => {
    const result = validateSchedule(doc, catalogs, categories);
    return result.ok ? "" : result.errors.join("\n");
  };
  assert.match(errors({ channels: { suomi: { slots: [{ at: "19:00", tape: "numa" }] } } }), /not on the suomi shelf/);
  assert.match(errors({ channels: { suomi: { slots: [{ at: "7:00", tape: "sandstorm" }] } } }), /HH:MM/);
  assert.match(errors({ channels: { suomi: { slots: [{ at: "19:00", tape: "sandstorm" }, { at: "19:00", tape: "sandstorm" }] } } }), /used twice/);
  assert.match(errors({ channels: { suomi: { slots: [{ at: "19:00", tape: "sandstorm" }, { at: "19:02", tape: "sandstorm" }] } } }), /runs into the next slot/);
  assert.match(errors({ channels: { "suomi-komedia": { slots: [{ at: "19:00", tape: "sandstorm" }] } } }), /not assigned to komedia/);
  assert.match(errors({ channels: { bogus: {} } }), /not a channel/);
  assert.match(errors({ channels: { suomi: { order: "random" } } }), /seeded.*catalog/);
  assert.match(errors({ channels: { suomi: { ident_seconds: 0 } } }), /ident_seconds/);
  assert.match(errors({ channels: { suomi: { hold_out_hours: 48 } } }), /hold_out_hours/);
  assert.match(errors({ channels: { suomi: { colour: "red" } } }), /not a schedule field/);
  assert.match(errors({ extra: 1 }), /not a schedule.json field/);
});

test("categories.json: every tape is assigned to known categories, and nothing else is", async () => {
  const { validateCategories } = await import("../lib/schema.mjs");
  const catalogs = { suomi: sample() };
  const ok = { channels: [{ id: "mtv", short: { suomi: "MTV", international: "MTV" }, name: { suomi: "M", international: "M" } }], assign: { sandstorm: ["mtv"] } };
  assert.equal(validateCategories(ok, catalogs).ok, true);
  const errors = (doc) => {
    const result = validateCategories(doc, catalogs);
    return result.ok ? "" : result.errors.join("\n");
  };
  assert.match(errors({ ...ok, assign: {} }), /missing tape "sandstorm"/);
  assert.match(errors({ ...ok, assign: { sandstorm: ["mtv"], ghost: ["mtv"] } }), /not a tape/);
  assert.match(errors({ ...ok, assign: { sandstorm: ["nope"] } }), /known category ids/);
  assert.match(errors({ ...ok, channels: [{ id: "MTV" }] }), /lowercase slug/);
});

test("checked-in categories.json and schedule.json validate", async () => {
  const { validateCategories, validateSchedule } = await import("../lib/schema.mjs");
  const read = async (f) => JSON.parse(await readFile(f, "utf8"));
  const catalogs = { suomi: await read("channels/suomi.json"), international: await read("channels/international.json") };
  const categories = await read("channels/categories.json");
  assert.deepEqual(validateCategories(categories, catalogs), { ok: true });
  assert.deepEqual(validateSchedule(await read("channels/schedule.json"), catalogs, categories), { ok: true });
});

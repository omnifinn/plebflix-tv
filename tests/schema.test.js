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
  const files = (await readdir("channels")).filter((name) => name.endsWith(".json") && name !== "categories.json");
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

import assert from "node:assert/strict";
import test from "node:test";
import { applyDrops, curateChannel, renderReport } from "../lib/curate.mjs";

function channel(id, items) {
  return {
    id,
    number: id === "suomi" ? 1 : 2,
    name: id === "suomi" ? "Suomi" : "International",
    tagline: "A shelf.",
    items,
  };
}

function tape(id, year = 2004) {
  return {
    id,
    title: id,
    year,
    source: "youtube",
    embedId: id.padEnd(11, "a").slice(0, 11),
    duration: 30,
    note: "A tape.",
    signals: ["a", "b", "c"],
    why: "It got passed around.",
    original_url: "https://example.com/tape",
    play: [
      {
        kind: "youtube",
        id_or_url: id.padEnd(11, "a").slice(0, 11),
        official: false,
        uploader: "test",
      },
    ],
    creator: id === "loved" ? "Gary" : undefined,
    tags: id === "loved" ? ["webcam"] : undefined,
  };
}

test("low scores drop, calibration tapes stay, and the shelf keeps 25", () => {
  const items = [tape("b5mies"), tape("loved", 2004)];
  for (let index = 0; index < 24; index += 1) items.push(tape(`filler-${index}`));
  items.push(tape("unloved", 2012));
  const doc = channel("suomi", items);
  const stats = {
    b5mies: { up: 1, down: 20 },
    unloved: { up: 1, down: 30 },
    loved: { up: 20, down: 1, impressions: 40 },
    "filler-0": { up: 0, down: 4 },
  };
  const plan = curateChannel(doc, stats);
  assert.deepEqual(
    plan.drops.map((row) => row.id),
    ["unloved"],
  );
  assert.equal(plan.held[0].id, "b5mies");
  assert.equal(plan.tops[0].id, "loved");
  assert.ok(plan.groups.eras["2000s"].includes("loved"));
  assert.deepEqual(plan.groups.creators.Gary, ["loved"]);
  assert.deepEqual(plan.groups.tags.webcam, ["loved"]);

  const thin = channel(
    "international",
    Array.from({ length: 25 }, (_, index) => tape(`only-${index}`)),
  );
  const hated = {};
  for (const item of thin.items) hated[item.id] = { up: 0, down: 20 };
  const tight = curateChannel(thin, hated);
  assert.equal(tight.drops.length, 0);
  assert.ok(tight.held.length >= 25);
});

test("the report names drops and the eras to look for", () => {
  const doc = channel(
    "international",
    Array.from({ length: 30 }, (_, index) => tape(index === 0 ? "tired" : `keep-${index}`, 1999)),
  );
  const stats = { tired: { up: 1, down: 15 } };
  const report = renderReport([doc], { international: stats }, { day: "2026-10-29" });
  assert.match(report.text, /tired/);
  assert.match(report.text, /2026-10-29/);
  const applied = applyDrops([doc], report.plans);
  assert.deepEqual(applied.removed, ["tired"]);
  assert.equal(applied.docs[0].items.some((item) => item.id === "tired"), false);
  assert.match(applied.resources, /Plebflix TV tape library/);
});

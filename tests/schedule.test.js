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

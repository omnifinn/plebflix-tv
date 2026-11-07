import assert from "node:assert/strict";
import test from "node:test";
import { airDate, chooseAirChannel, liveItems } from "../public/schedule.js";

const nov7 = Date.parse("2026-11-07T19:43:00.000Z");
const nov8 = Date.parse("2026-11-08T00:00:00.000Z");

test("a tape filed today is off the programme until the next UTC day", () => {
  const channel = {
    items: [
      { id: "like-a-boss", duration: 147, added: "2026-11-07" },
      { id: "numa-numa", duration: 100, added: "2026-11-06" },
      { id: "old", duration: 10 },
    ],
  };
  assert.deepEqual(liveItems(channel, nov7).map((item) => item.id), ["numa-numa", "old"]);
  assert.deepEqual(liveItems(channel, nov8).map((item) => item.id), ["like-a-boss", "numa-numa", "old"]);
  assert.equal(airDate("2026-11-07"), "2026-11-08");
  assert.equal(airDate("2026-12-31"), "2027-01-01");
  assert.equal(airDate("soon"), null);
});

test("search chooses the channel that airs the tape today and refuses one that does not", () => {
  const order = ["international", "international-komedia", "suomi", "suomi-komedia"];
  const langOf = (id) => (id.startsWith("suomi") ? "suomi" : "international");
  const airs = {
    international: ["numa-numa"],
    "international-komedia": ["numa-numa"],
    suomi: ["b5mies"],
    "suomi-komedia": ["b5mies"],
  };
  const airsOn = (cid, id) => (airs[cid] || []).includes(id);
  const ctx = (current) => ({ current, order, langOf, airsOn });
  assert.equal(chooseAirChannel("numa-numa", ctx("suomi")), "international");
  assert.equal(chooseAirChannel("b5mies", ctx("international")), "suomi");
  assert.equal(chooseAirChannel("numa-numa", ctx("international-komedia")), "international-komedia");
  assert.equal(chooseAirChannel("numa-numa", ctx("international")), "international");
  assert.equal(chooseAirChannel("like-a-boss", ctx("suomi")), null);
  assert.equal(chooseAirChannel("like-a-boss", ctx("international")), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { fold, buildIndex, search } from "../public/search.js";
const cat = [
  { id: "suomi", name: "Suomi", items: [
    { id: "kahen-kilon-siika", title: "Kahden kilon siika", year: 2008, duration: 30 },
    { id: "ismo-seppo-saunassa", title: "Ismo ja Seppo saunassa", year: 2009, duration: 30 },
    { id: "kummeli-artisti-maksaa", title: "Artisti maksaa", year: 1994, duration: 30 },
  ] },
  { id: "international", name: "International", items: [
    { id: "numa-numa", title: "Numa Numa", year: 2004, duration: 30 },
    { id: "leeroy-jenkins", title: "Leeroy Jenkins", year: 2005, duration: 30 },
    { id: "kissa", title: "Pähkinä Äänet Öljy", year: 2001, duration: 30 },
  ] },
  { id: "gaming", name: "Gaming", items: [{ id: "leeroy-jenkins", title: "Leeroy Jenkins", year: 2005, duration: 30 }] },
];
const idx = buildIndex(cat);
test("folds Finnish letters", () => assert.equal(fold("Pähkinä ÄÄNET öljy"), "pahkina aanet oljy"));
test("prefix + exact", () => assert.equal(search(idx, "num")[0].item.id, "numa-numa"));
test("typos", () => {
  assert.equal(search(idx, "leroy jenkns")[0].item.id, "leeroy-jenkins");
  assert.equal(search(idx, "siikka")[0].item.id, "kahen-kilon-siika");
});
test("finnish chars either way", () => {
  assert.equal(search(idx, "pahkina")[0].item.id, "kissa");
  assert.equal(search(idx, "äänet")[0].item.id, "kissa");
});
test("year and channel", () => {
  assert.equal(search(idx, "1994")[0].item.id, "kummeli-artisti-maksaa");
  assert.equal(search(idx, "kummeli")[0].item.id, "kummeli-artisti-maksaa");
  assert.equal(search(idx, "gaming")[0].item.id, "leeroy-jenkins");
  assert.deepEqual(search(idx, "leeroy")[0].chans.sort(), ["gaming", "international"]);
});

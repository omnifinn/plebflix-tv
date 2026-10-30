import assert from "node:assert/strict";
import test from "node:test";
import { hashIp, normalizeIp } from "../lib/ip.mjs";

test("IPv4 stays, IPv6 collapses to its /64, mapped v4 unwraps", () => {
  assert.equal(normalizeIp("1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("2001:db8:1:2:3:4:5:6"), "2001:0db8:0001:0002::/64");
  assert.equal(normalizeIp("2001:db8:1:2::9"), "2001:0db8:0001:0002::/64");
  assert.equal(normalizeIp("2001:db8::1"), "2001:0db8:0000:0000::/64");
  assert.equal(normalizeIp("[2001:db8::1]"), "2001:0db8:0000:0000::/64");
  assert.equal(normalizeIp("fe80::1%en0"), "fe80:0000:0000:0000::/64");
  assert.equal(normalizeIp("::ffff:10.0.0.7"), "10.0.0.7");
  assert.equal(normalizeIp("not:an:ip"), "not:an:ip");
});

test("two addresses in one /64 hash the same; a salt changes the hash", async () => {
  const a = await hashIp("2001:db8:1:2:aaaa::1");
  const b = await hashIp("2001:db8:1:2:bbbb::2");
  const c = await hashIp("2001:db8:1:3::1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(await hashIp("1.2.3.4"), await hashIp("1.2.3.4", "other-salt"));
  assert.match(a, /^[0-9a-f]{32}$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isIP } from "node:net";

import { pinnedLookup } from "../src/premium/asset-source.js";

/**
 * Why this file exists: `pinnedHttpsRequest` overrides `https.request`'s `lookup` option so the
 * socket always connects to the address we already DNS-rebinding-checked. Node 22's HTTPS agent
 * calls that `lookup` with `{ all: true }` on some code paths, and per Node's own contract that
 * means the callback must receive an ARRAY of `{ address, family }` — not a bare address string.
 *
 * The original shim ignored `options.all` entirely and always called back with a bare string.
 * When Node invoked it with `all: true`, Node tried to read `.address` off a string and blew up
 * with "Invalid IP address: undefined" from `emitLookup (node:net:1495)`. That meant EVERY
 * premium asset fetch failed in production (Node 22, matching the `node:22-bookworm-slim` image),
 * and the engine silently fell back to generic overlays — while every existing test passed,
 * because `asset-source.test.ts` injects a fake `request` dependency and never actually executes
 * `pinnedHttpsRequest` (or this lookup shim) at all.
 *
 * This test asserts BOTH callback contracts the shim must honour.
 */

test("pinnedLookup honours options.all=true with an array of {address, family}", () => {
  const lookup = pinnedLookup("93.184.216.34");
  let called = false;
  lookup("ignored-hostname", { all: true }, (err, address, family) => {
    called = true;
    assert.equal(err, null);
    assert.ok(Array.isArray(address), "with all:true, address must be an array");
    assert.deepEqual(address, [{ address: "93.184.216.34", family: 4 }]);
    // Per Node's LookupFunction contract, `family` (the 3rd callback arg) is only meaningful for
    // the non-array (legacy) path; we don't assert on it here.
    void family;
  });
  assert.ok(called, "callback must be invoked synchronously");
});

test("pinnedLookup keeps the legacy triple for options.all=false / omitted", () => {
  const lookup = pinnedLookup("93.184.216.34");

  let called = false;
  lookup("ignored-hostname", {}, (err, address, family) => {
    called = true;
    assert.equal(err, null);
    assert.equal(address, "93.184.216.34", "without all:true, address must be the bare string");
    assert.equal(family, 4);
  });
  assert.ok(called, "callback must be invoked synchronously for the {} options case");

  called = false;
  lookup("ignored-hostname", { all: false }, (err, address, family) => {
    called = true;
    assert.equal(err, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
  assert.ok(called, "callback must be invoked synchronously for the all:false case");
});

test("pinnedLookup reports family 4 for an IPv4 pinned address and 6 for IPv6", () => {
  const v4 = "93.184.216.34";
  const v6 = "2606:2800:220:1:248:1893:25c8:1946";
  assert.equal(isIP(v4), 4);
  assert.equal(isIP(v6), 6);

  let v4Family: number | undefined;
  pinnedLookup(v4)("host", { all: true }, (_err, address) => {
    v4Family = Array.isArray(address) ? address[0].family : undefined;
  });
  assert.equal(v4Family, 4);

  let v6Family: number | undefined;
  pinnedLookup(v6)("host", { all: true }, (_err, address) => {
    v6Family = Array.isArray(address) ? address[0].family : undefined;
  });
  assert.equal(v6Family, 6);

  let v4LegacyFamily: number | undefined;
  pinnedLookup(v4)("host", {}, (_err, _address, family) => {
    v4LegacyFamily = family;
  });
  assert.equal(v4LegacyFamily, 4);

  let v6LegacyFamily: number | undefined;
  pinnedLookup(v6)("host", {}, (_err, _address, family) => {
    v6LegacyFamily = family;
  });
  assert.equal(v6LegacyFamily, 6);
});

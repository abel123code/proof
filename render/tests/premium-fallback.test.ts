import { test } from "node:test";
import assert from "node:assert/strict";

import { premiumFallbackReport, premiumEngineWarning } from "../src/premium/fallback.js";

test("premiumFallbackReport records the whole-tier fallback as an auditable base_fallback report", () => {
  const r = premiumFallbackReport("hyperframes CLI not installed");
  assert.equal(r.verdict, "base_fallback");
  assert.equal(r.shipped, false, "a fallback did NOT ship bespoke scenes");
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, "safety");
  // The reason must be carried through verbatim so the studio/log can show WHY nothing rendered.
  assert.match(r.issues[0].text, /hyperframes CLI not installed/);
});

test("premiumEngineWarning warns ONLY when premium mode is on but the engine is missing", () => {
  assert.ok(
    premiumEngineWarning("generated-experimental", false),
    "premium selected + engine missing must warn (every render would fall back)",
  );
  assert.equal(
    premiumEngineWarning("generated-experimental", true),
    null,
    "engine present -> coherent -> no warning",
  );
  assert.equal(premiumEngineWarning("brief-driven", false), null, "non-premium mode never warns");
  assert.equal(premiumEngineWarning("classic", false), null, "non-premium mode never warns");
});

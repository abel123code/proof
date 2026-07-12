import { test } from "node:test";
import assert from "node:assert/strict";

import { scriptToVocabPrompt } from "../src/transcribe.js";
import { normalizeScenes } from "../src/premium/scenes.js";

test("vocab prompt mines product names / acronyms / camelCase + keyword flags, deduped", () => {
  const v = scriptToVocabPrompt(
    "We ship with Next.js and Trigger.dev into the SUTD eDimension portal.",
    ["Gradescope", "AI SEO"],
  );
  assert.ok(v, "expected a vocab hint");
  for (const term of ["Next.js", "Trigger.dev", "SUTD", "eDimension", "Gradescope", "AI SEO"]) {
    assert.ok(v!.includes(term), `vocab hint missing "${term}": ${v}`);
  }
});

test("vocab prompt ignores plain sentence-initial capitals and returns undefined when empty", () => {
  // "We"/"The" are sentence-initial caps, not product names — nothing to hint.
  assert.equal(scriptToVocabPrompt("We shipped the thing today.", []), undefined);
});

test("normalizeScenes snaps anchors to word starts, clamps durations, drops overlaps", () => {
  const wordStarts = [0, 500, 1200, 2000, 3000, 4200, 5000];
  const raw = [
    { anchorMs: 480, durMs: 100, intent: "snaps to 0; 100ms clamped up to the 1500ms floor" },
    { anchorMs: 1250, durMs: 3000, intent: "snaps to 1200 which overlaps the first scene -> dropped" },
    { anchorMs: 2100, durMs: 9000, intent: "snaps to 2000; 9000ms clamped, tail clamped to total" },
  ];

  const out = normalizeScenes(raw, wordStarts, "chip-motif", 6000);

  assert.equal(out.length, 2, "the overlapping middle scene is dropped");
  assert.equal(out[0].anchorMs, 0);
  assert.equal(out[0].durMs, 1500, "sub-floor duration is raised to 1500ms");
  assert.equal(out[0].id, "scene-1");
  assert.equal(out[1].anchorMs, 2000);
  assert.equal(out[1].durMs, 4000, "duration clamped so the scene ends at totalMs (6000)");
  assert.equal(out[1].id, "scene-2");
  assert.equal(out[0].motif, "chip-motif");
});

test("normalizeScenes rejects scenes anchored at/after the video end", () => {
  const out = normalizeScenes(
    [{ anchorMs: 9000, durMs: 2000, intent: "past the end" }],
    [0, 1000, 9000],
    "m",
    5000,
  );
  assert.equal(out.length, 0);
});

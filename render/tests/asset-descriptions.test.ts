import { test } from "node:test";
import assert from "node:assert/strict";

import { planEdit } from "../src/premium/scenes.js";
import type { RenderBrief, Word } from "../src/types.js";

const words = (pairs: Array<[number, string]>): Word[] =>
  pairs.map(([startMs, text]) => ({ text, startMs, endMs: startMs + 300 }));

const brief: RenderBrief = {
  script: "My class literally had to rely on a Telegram chat",
  keywordFlags: [],
};

test("planEdit payload assets carry file + depicts when descriptions are supplied", async () => {
  const w = words([[0, "My"], [300, "class"]]);
  let payload: any;
  await planEdit({
    brief,
    words: w,
    durationMs: 5000,
    assetHints: ["ad86358e.jpg", "5729ad2f.jpg"],
    assetDescriptions: {
      "ad86358e.jpg": "Chrome extension popup showing a deadline list",
      "5729ad2f.jpg": "Calendar export settings screen",
    },
    generate: async (p) => {
      payload = JSON.parse(p);
      return { creativeDirection: {}, beats: [] };
    },
  });
  assert.deepEqual(payload.assets, [
    { file: "ad86358e.jpg", depicts: "Chrome extension popup showing a deadline list" },
    { file: "5729ad2f.jpg", depicts: "Calendar export settings screen" },
  ]);
});

test("planEdit marks an asset with no description as depicts: unknown rather than dropping it", async () => {
  const w = words([[0, "My"], [300, "class"]]);
  let payload: any;
  await planEdit({
    brief,
    words: w,
    durationMs: 5000,
    assetHints: ["ad86358e.jpg", "f8758ea1.jpg"],
    assetDescriptions: {
      "ad86358e.jpg": "Chrome extension popup showing a deadline list",
      // f8758ea1.jpg intentionally missing
    },
    generate: async (p) => {
      payload = JSON.parse(p);
      return { creativeDirection: {}, beats: [] };
    },
  });
  assert.deepEqual(payload.assets, [
    { file: "ad86358e.jpg", depicts: "Chrome extension popup showing a deadline list" },
    { file: "f8758ea1.jpg", depicts: "unknown" },
  ]);
});

test("planEdit with no descriptions at all still produces one entry per asset hint, all unknown", async () => {
  const w = words([[0, "My"], [300, "class"]]);
  let payload: any;
  await planEdit({
    brief,
    words: w,
    durationMs: 5000,
    assetHints: ["ad86358e.jpg", "5729ad2f.jpg", "f8758ea1.jpg"],
    generate: async (p) => {
      payload = JSON.parse(p);
      return { creativeDirection: {}, beats: [] };
    },
  });
  assert.deepEqual(payload.assets, [
    { file: "ad86358e.jpg", depicts: "unknown" },
    { file: "5729ad2f.jpg", depicts: "unknown" },
    { file: "f8758ea1.jpg", depicts: "unknown" },
  ]);
});

test("planEdit with zero asset hints produces an empty assets array, not a crash", async () => {
  const w = words([[0, "My"], [300, "class"]]);
  let payload: any;
  await planEdit({
    brief,
    words: w,
    durationMs: 5000,
    assetHints: [],
    assetDescriptions: { "unused.jpg": "should not matter" },
    generate: async (p) => {
      payload = JSON.parse(p);
      return { creativeDirection: {}, beats: [] };
    },
  });
  assert.deepEqual(payload.assets, []);
});

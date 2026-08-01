import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeEditPlan } from "../src/premium/scenes.js";

const words = Array.from({ length: 61 }, (_, second) => ({
  text: `w${second}`,
  startMs: second * 1000,
  endMs: second * 1000 + 500,
}));

test("normalizeEditPlan enforces creator-native coverage budgets", () => {
  const plan = normalizeEditPlan({
    raw: {
      creativeDirection: {},
      beats: [
        { anchorMs: 0, durMs: 9000, mode: "full-frame", intent: "opening mechanism", priority: 100 },
        { anchorMs: 12000, durMs: 9000, mode: "full-frame", intent: "comparison", priority: 90 },
        { anchorMs: 24000, durMs: 9000, mode: "full-frame", intent: "process", priority: 80 },
        { anchorMs: 36000, durMs: 9000, mode: "overlay", intent: "one number", priority: 70 },
        { anchorMs: 47000, durMs: 9000, mode: "overlay", intent: "one toggle", priority: 60 },
      ],
    },
    words,
    durationMs: 60000,
    fallbackColor: "#d9ff45",
  });

  assert.ok(plan.coverage.fullFrameRatio <= 0.4);
  assert.ok(plan.coverage.overlayRatio <= 0.35);
  assert.ok(plan.coverage.cleanRatio >= 0.25);
  assert.ok(plan.scenes.every((scene) => scene.mode === "overlay" || scene.mode === "full-frame"));
  assert.ok(plan.scenes.filter((scene) => scene.mode === "full-frame").every((scene) => scene.anchorMs >= 2000));
  assert.ok(plan.scenes.filter((scene) => scene.mode === "full-frame").every((scene) => scene.anchorMs + scene.durMs <= 58000));
});

test("normalizeEditPlan preserves a three-second clean interval on videos over thirty seconds", () => {
  const plan = normalizeEditPlan({
    raw: {
      creativeDirection: {},
      beats: Array.from({ length: 10 }, (_, index) => ({
        anchorMs: index * 4000,
        durMs: 3000,
        mode: index % 2 ? "overlay" : "full-frame",
        intent: `beat ${index}`,
        priority: 100 - index,
      })),
    },
    words,
    durationMs: 45000,
    fallbackColor: "#d9ff45",
  });

  assert.ok(plan.cleanIntervals.some((interval) => interval.endMs - interval.startMs >= 3000));
});

test("normalizeEditPlan inserts recovery before an overlay after a full-frame run", () => {
  const plan = normalizeEditPlan({
    raw: {
      creativeDirection: {},
      beats: [
        { anchorMs: 5000, durMs: 5000, mode: "full-frame", intent: "explain", priority: 100 },
        { anchorMs: 10000, durMs: 3000, mode: "overlay", intent: "support", priority: 90 },
      ],
    },
    words,
    durationMs: 30000,
    fallbackColor: "#d9ff45",
  });

  assert.equal(plan.scenes[0].mode, "full-frame");
  assert.equal(plan.scenes[1].mode, "overlay");
  assert.ok(plan.scenes[1].anchorMs >= plan.scenes[0].anchorMs + plan.scenes[0].durMs + 1000);
});

test("normalizeEditPlan does not invent full-frame beats when the planner proposes none", () => {
  const plan = normalizeEditPlan({
    raw: {
      creativeDirection: {},
      beats: [{ anchorMs: 4000, durMs: 2500, mode: "overlay", intent: "one metric", priority: 80 }],
    },
    words,
    durationMs: 30000,
    fallbackColor: "#d9ff45",
  });

  assert.equal(plan.scenes.filter((scene) => scene.mode === "full-frame").length, 0);
});

test("normalizeEditPlan preserves blackout only for full-frame beats", () => {
  const plan = normalizeEditPlan({
    raw: {
      creativeDirection: {},
      beats: [
        {
          anchorMs: 4000,
          durMs: 2500,
          mode: "full-frame",
          backgroundTreatment: "black",
          intent: "make the mechanism the sole focus",
          priority: 100,
        },
        {
          anchorMs: 9000,
          durMs: 2500,
          mode: "overlay",
          backgroundTreatment: "black",
          intent: "show one supporting number",
          priority: 90,
        },
        {
          anchorMs: 14000,
          durMs: 2500,
          mode: "full-frame",
          intent: "keep the speaker visible beside a large diagram",
          priority: 80,
        },
      ],
    },
    words,
    durationMs: 30000,
    fallbackColor: "#d9ff45",
  });

  assert.deepEqual(
    plan.scenes.map((scene) => [scene.mode, scene.backgroundTreatment]),
    [
      ["full-frame", "black"],
      ["overlay", "footage"],
      ["full-frame", "footage"],
    ],
  );
});

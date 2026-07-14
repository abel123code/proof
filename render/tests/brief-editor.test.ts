import { test } from "node:test";
import assert from "node:assert/strict";

import {
  anchorVisualCuesToTranscript,
  applyCaptionCopyAndEmphasis,
  buildSceneWindows,
  buildVisualCues,
  shortenHeadline,
} from "../src/brief-editor.js";
import { planCut } from "../src/cut.js";
import type { RenderBrief, Word } from "../src/types.js";

const scenes = [
  {
    label: "Hook",
    spokenLine: "I stopped writing invisible posts.",
    onScreenText: "Stop writing invisible posts",
    brollCue: "Punch in on the creator",
    durationSeconds: 4,
  },
  {
    label: "Proof",
    spokenLine: "It reached 12,000 developers.",
    onScreenText: "12,000 developers",
    brollCue: "Show the number growing",
    durationSeconds: 4,
  },
];

test("scene windows retain scene boundaries after removed gaps", () => {
  const windows = buildSceneWindows(
    scenes,
    [4000, 4000],
    [
      { startMs: 0, endMs: 3500 },
      { startMs: 4200, endMs: 8000 },
    ],
    7300,
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0].startMs, 0);
  assert.equal(windows[0].endMs, 3500);
  assert.equal(windows[1].startMs, 3500);
  assert.equal(windows[1].endMs, 7300);
});

test("visual cues use brief semantics and concise headlines", () => {
  const windows = buildSceneWindows(scenes, [4000, 4000], [{ startMs: 0, endMs: 8000 }], 8000);
  const cues = buildVisualCues(windows, "Nobody sees your posts");
  assert.equal(cues[0].template, "hook");
  assert.equal(cues[1].template, "metric");
  assert.ok(cues.every((cue) => cue.headline.split(/\s+/).length <= 6));
});

test("visual cues start when their on-screen concept is spoken", () => {
  const windows = buildSceneWindows(scenes, [4000, 4000], [{ startMs: 0, endMs: 8000 }], 8000);
  const cues = buildVisualCues(windows, "Nobody sees your posts");
  const words: Word[] = [
    { text: "I", startMs: 0, endMs: 200 },
    { text: "stopped", startMs: 250, endMs: 550 },
    { text: "writing", startMs: 600, endMs: 900 },
    { text: "invisible", startMs: 950, endMs: 1300 },
    { text: "posts", startMs: 1350, endMs: 1650 },
    { text: "It", startMs: 4000, endMs: 4200 },
    { text: "reached", startMs: 4250, endMs: 4500 },
    { text: "12,000", startMs: 4700, endMs: 5100 },
    { text: "developers.", startMs: 5150, endMs: 5550 },
  ];
  const anchored = anchorVisualCuesToTranscript(cues, windows, words);
  assert.equal(anchored[0].startMs, 90, "hook card enters just before 'stopped'");
  assert.equal(anchored[1].startMs, 4540, "metric card enters just before '12,000'");
});

test("headline shortening preserves the strongest compact words", () => {
  assert.equal(
    shortenHeadline("This is the simple process for building a much better developer audience", "fallback"),
    "This simple process building much better",
  );
});

test("caption copy preserves every word while restoring script punctuation and emphasis", () => {
  const words: Word[] = [
    { text: "it", startMs: 0, endMs: 200 },
    { text: "reached", startMs: 200, endMs: 500 },
    { text: "12000", startMs: 500, endMs: 850 },
    { text: "developers", startMs: 850, endMs: 1200 },
  ];
  const brief: RenderBrief = {
    script: "It reached 12000 developers.",
    keywordFlags: [],
    scenes: [scenes[1]],
  };
  const result = applyCaptionCopyAndEmphasis(words, brief);
  assert.equal(result.length, words.length);
  assert.deepEqual(result.map((word) => word.text), ["It", "reached", "12000", "developers."]);
  assert.equal(result[2].emphasis, true);
  assert.equal(result[3].emphasis, true);
});

test("cut planner does not clip long spoken words by default", () => {
  const plan = planCut([
    { word: "extraordinary", start: 0, end: 1.1 },
    { word: "result", start: 1.2, end: 1.6 },
  ]);
  assert.equal(plan.keptWords[0].end, 1.1);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildKeywordCues,
  buildKeywordCuesForMode,
  buildOverlayCues,
} from "../src/cues.js";
import { cleanTerms } from "../src/terms.js";
import { remap } from "../src/remap.js";
import type { KeepSegment, WhisperWord, Word } from "../src/types.js";

const w = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs });

test("keyword cue matches a phrase that cleanTerms merged into one word", () => {
  // Whisper splits "AI SEO" into two words; cleanTerms merges them into a single
  // Word whose text is "AI SEO". The flag is still written as two words.
  const merged = cleanTerms([w("we", 0, 300), w("use", 300, 600), w("ai", 600, 900), w("seo", 900, 1200)]);
  assert.equal(merged[2].text, "AI SEO", "precondition: cleanTerms merged the pair");

  const cues = buildKeywordCues(merged, [{ phrase: "AI SEO" }]);
  assert.equal(cues.length, 1, "flag 'AI SEO' must still anchor after merging");
  assert.equal(cues[0].startMs, 600);
});

test("keyword cue matches a split-form flag against a merged transcript word", () => {
  const merged = cleanTerms([w("ship", 0, 300), w("trigger", 300, 600), w("dev", 600, 900)]);
  assert.equal(merged[1].text, "Trigger.dev");

  const cues = buildKeywordCues(merged, [{ phrase: "trigger dev" }]);
  assert.equal(cues.length, 1, "flag written as two words must match the merged word");
  assert.equal(cues[0].startMs, 300);
});

test("keyword cue still matches an ordinary multi-word phrase", () => {
  const words = [w("cuts", 0, 300), w("dead", 300, 600), w("spaces", 600, 900)];
  const cues = buildKeywordCues(words, [{ phrase: "dead spaces" }]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 300);
  assert.equal(cues[0].endMs, 900 + 900); // +900ms linger
});

test("keyword cue does not match a partial prefix of a longer word", () => {
  const words = [w("aisle", 0, 300)];
  assert.equal(buildKeywordCues(words, [{ phrase: "ai" }]).length, 0);
});

test("premium mode removes fixed keyword chips before vision QA", () => {
  const words = [w("eDimension", 0, 500)];
  const flags = [{ phrase: "eDimension" }];
  assert.deepEqual(buildKeywordCuesForMode(words, flags, "generated-experimental"), []);
  assert.equal(buildKeywordCuesForMode(words, flags, "brief-driven").length, 1);
  assert.equal(buildKeywordCuesForMode(words, flags, "classic").length, 1);
});

test("overlay cue anchored to a merged keyword resolves", () => {
  const merged = cleanTerms([w("uses", 0, 300), w("next", 300, 600), w("js", 600, 900)]);
  const cues = buildOverlayCues(
    merged,
    [{ type: "text-card", content: "hi", anchor: { kind: "keyword", keyword: "next js" }, durationMs: 1000 }],
    5000,
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 300);
});

test("remap gives a zero-duration whisper word a visible caption window", () => {
  // whisper-1 really does emit start === end (observed: "script", "seeing").
  const words: WhisperWord[] = [
    { word: "writes", start: 0.0, end: 0.4 },
    { word: "script", start: 0.5, end: 0.5 },
  ];
  const segments: KeepSegment[] = [{ startMs: 0, endMs: 1000 }];
  const r = remap(words, segments);

  const last = r.words[r.words.length - 1];
  assert.equal(last.text, "script");
  assert.ok(
    last.endMs - last.startMs >= 120,
    `zero-duration word must be widened to >=120ms, got ${last.endMs - last.startMs}ms`,
  );
});

test("remap never widens a word past the start of the next word", () => {
  const words: WhisperWord[] = [
    { word: "a", start: 0.0, end: 0.0 },
    { word: "b", start: 0.05, end: 0.3 },
  ];
  const r = remap(words, [{ startMs: 0, endMs: 1000 }]);
  assert.ok(r.words[0].endMs <= r.words[1].startMs, "widened word must not overlap the next word");
});

test("remap leaves normal-length words untouched", () => {
  const words: WhisperWord[] = [{ word: "hello", start: 0.2, end: 0.7 }];
  const r = remap(words, [{ startMs: 0, endMs: 1000 }]);
  assert.equal(r.words[0].startMs, 200);
  assert.equal(r.words[0].endMs, 700);
});

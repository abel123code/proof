import test from "node:test";
import assert from "node:assert/strict";
import { sceneWords } from "../src/premium/scene-words.js";

/**
 * A scene's GSAP timeline starts at 0, so absolute transcript times would mean nothing to the
 * author. Everything here is rebased onto the scene's own clock — that rebasing is what makes
 * "reveal this row at 1240ms" mean the same thing to the author and to the finished video.
 */

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

const WORDS = [
  w("before", 0, 500),
  w("one", 1000, 1200),
  w("clean", 1250, 1500),
  w("list", 1550, 1900),
  w("after", 4000, 4400),
];

test("returns only the words spoken inside the scene window", () => {
  const out = sceneWords(WORDS, 1000, 2000);
  assert.deepEqual(out.map((x) => x.text), ["one", "clean", "list"]);
});

test("rebases times to the scene start, because the scene's timeline starts at zero", () => {
  const out = sceneWords(WORDS, 1000, 2000);
  assert.deepEqual(out.map((x) => x.atMs), [0, 250, 550]);
});

test("keeps a word straddling the start when most of it is inside", () => {
  // "one" runs 900-1200 against a scene starting at 1000: 200 of its 300ms is inside.
  const out = sceneWords([w("one", 900, 1200)], 1000, 2000);
  assert.deepEqual(out.map((x) => x.text), ["one"]);
  // Never negative: a word that began before the scene lands at 0.
  assert.equal(out[0].atMs, 0);
});

test("drops a word that merely brushes the window", () => {
  // Only 50ms of this 400ms word is inside; it belongs to the previous scene, and counting it in
  // both would fire a reveal against a word the viewer already heard.
  assert.deepEqual(sceneWords([w("edge", 650, 1050)], 1000, 2000), []);
});

test("returns an empty list for a silent scene rather than throwing", () => {
  assert.deepEqual(sceneWords(WORDS, 10_000, 2000), []);
  assert.deepEqual(sceneWords([], 0, 2000), []);
});

test("keeps the transcript's order", () => {
  const out = sceneWords(WORDS, 0, 5000);
  assert.deepEqual(out.map((x) => x.text), ["before", "one", "clean", "list", "after"]);
});

test("survives a zero-length word without dividing by zero", () => {
  const out = sceneWords([w("blip", 1200, 1200)], 1000, 2000);
  assert.deepEqual(out, []);
});

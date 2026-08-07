import test from "node:test";
import assert from "node:assert/strict";
import { checkSceneMotion } from "../src/premium/motion-gate.js";

// Real failing shape from the measured 53s production render (mean pixel delta 0.0-1.9 for
// seconds at a time between cuts): four entrance tweens, then a dummy empty tween pads the
// remainder of the 2.8s scene. holdRatio should read 1.0 — the WHOLE scene is padding, since
// the entrance tweens complete instantly (no duration) and the empty tween alone spans it.
const OBSERVED_FAILURE_HTML = `
  const tl = gsap.timeline({ paused: true });
  tl.to(".source-left",  { opacity: 1, x: 0, duration: 0.01 });
  tl.to(".source-right", { opacity: 1, x: 0, duration: 0.01 });
  tl.to(".divider",      { scaleY: 1, duration: 0.01 });
  tl.to(".headline",     { opacity: 1, y: 0, duration: 0.01 });
  tl.to({}, { duration: 2.80 }, 0);
`;

test("the observed production failure (4 entrance tweens + full-scene empty hold) fails with holdRatio 1.0", () => {
  const r = checkSceneMotion(OBSERVED_FAILURE_HTML, 2.8);
  assert.equal(r.ok, false);
  assert.equal(r.holdRatio, 1);
  assert.match(r.reason ?? "", /empty|hold|freeze|still/i);
});

test("a short pad tween (0.3s of a 3s scene) with real sustained motion passes, holdRatio 0.1", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.to(".headline", { opacity: 1, y: 0, duration: 1.2 });
    tl.to(".chart-bar", { scaleY: 1, duration: 1.5 }, 1.0);
    tl.to({}, { duration: 0.3 }, 2.7);
  `;
  const r = checkSceneMotion(html, 3);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.holdRatio - 0.1) < 1e-9, `expected holdRatio ~0.1, got ${r.holdRatio}`);
});

test("sustained tweens spread across the full duration pass, no empty tween present", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.to(".headline", { opacity: 1, y: 0, duration: 1.0 }, 0);
    tl.to(".row-1", { opacity: 1, duration: 1.0 }, 1.2);
    tl.to(".row-2", { opacity: 1, duration: 1.0 }, 2.4);
    tl.to(".conclusion", { scale: 1.05, duration: 0.6 }, 3.6);
  `;
  const r = checkSceneMotion(html, 4.2);
  assert.equal(r.ok, true);
  assert.equal(r.holdRatio, 0);
});

test("a single entrance tween with nothing after it fails, even with no empty tween", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.to(".headline", { opacity: 1, y: 0, duration: 3.0 });
  `;
  const r = checkSceneMotion(html, 3.0);
  assert.equal(r.ok, false);
  assert.equal(r.holdRatio, 0);
  assert.match(r.reason ?? "", /one|single|entrance|develop/i);
});

test("no empty tween at all, three real tweens, passes", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.to(".a", { opacity: 1, duration: 0.8 }, 0);
    tl.to(".b", { opacity: 1, duration: 0.8 }, 1.0);
    tl.to(".c", { opacity: 1, duration: 0.8 }, 2.0);
  `;
  const r = checkSceneMotion(html, 2.8);
  assert.equal(r.ok, true);
  assert.equal(r.holdRatio, 0);
});

test("gsap.to({}, ...) spelled without the tl. prefix is still detected", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.to(".headline", { opacity: 1, duration: 0.5 });
    tl.to(".sub", { opacity: 1, duration: 0.5 }, 0.5);
    gsap.to({}, { duration: 2.0 }, 1);
  `;
  const r = checkSceneMotion(html, 3.0);
  assert.equal(r.ok, false, "the trailing empty hold is 2.0s of a 3.0s scene (0.67 ratio) — must fail");
  assert.ok(r.holdRatio >= 0.5);
});

test("durationSec 0 does not divide by zero and does not throw", () => {
  assert.doesNotThrow(() => checkSceneMotion(OBSERVED_FAILURE_HTML, 0));
  const r = checkSceneMotion(OBSERVED_FAILURE_HTML, 0);
  assert.equal(Number.isFinite(r.holdRatio), true);
  assert.equal(r.ok, false);
});

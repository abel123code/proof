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

// Found in production: scene-1 and scene-4 of job f68a8dab were both branded "0 real tweens —
// frozen" and re-authored twice each, on scenes that visibly animate. The detector counted only
// `.to()`. A reveal is idiomatically written with `.from()` (animate rows IN from an offset), so
// those scenes registered zero motion, burned the entire retry budget on a problem that did not
// exist, and starved the vision QA — whose real complaint (an oversized, clipped screenshot) then
// had no attempts left and shipped.
test("a staggered reveal written with .from() counts as real motion", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.from(".panel", { opacity: 0, y: 40, duration: 0.6 });
    tl.from(".row-1", { opacity: 0, x: -30, duration: 0.5 }, 1.2);
    tl.from(".row-2", { opacity: 0, x: -30, duration: 0.5 }, 2.4);
  `;
  assert.equal(checkSceneMotion(html, 4.5).ok, true);
});

test(".fromTo() counts as real motion", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(".chip", { scale: 0.8 }, { scale: 1, duration: 0.5 });
    tl.fromTo(".card", { y: 30 }, { y: 0, duration: 0.5 }, 1.5);
  `;
  assert.equal(checkSceneMotion(html, 3).ok, true);
});

test("a timeline mixing .from() and .to() counts both", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.from(".panel", { opacity: 0, duration: 0.5 });
    tl.to(".panel", { scale: 1.05, duration: 0.6 }, 2);
  `;
  assert.equal(checkSceneMotion(html, 3).ok, true);
});

test("a single .from() entrance and nothing after it still fails", () => {
  // Counting .from() must not blind the gate to the defect it exists for.
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.from(".panel", { opacity: 0, y: 40, duration: 0.6 });
  `;
  const r = checkSceneMotion(html, 4);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /only 1 real tween/);
});

test("an empty pad tween still dominates even when the real motion is .from()", () => {
  const html = `
    const tl = gsap.timeline({ paused: true });
    tl.from(".panel", { opacity: 0, duration: 0.3 });
    tl.from(".row",   { opacity: 0, duration: 0.3 }, 0.4);
    tl.to({}, { duration: 3.2 });
  `;
  assert.equal(checkSceneMotion(html, 4).ok, false);
});

test("durationSec 0 does not divide by zero and does not throw", () => {
  assert.doesNotThrow(() => checkSceneMotion(OBSERVED_FAILURE_HTML, 0));
  const r = checkSceneMotion(OBSERVED_FAILURE_HTML, 0);
  assert.equal(Number.isFinite(r.holdRatio), true);
  assert.equal(r.ok, false);
});

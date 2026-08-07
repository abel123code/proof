import test from "node:test";
import assert from "node:assert/strict";
import { checkImageFraming } from "../src/premium/framing-gate.js";

// Every test wraps content in the REAL mandatory stage markup from author.ts's HARD CONTRACT
// (inline position:relative + overflow:hidden on #stage). A fake stage without those inline
// styles would never exercise the actual bypass: the gate must special-case #stage, not merely
// fail to notice it.
const STAGE_OPEN =
  `<div id="stage" data-composition-id="s1" data-width="1080" data-height="1920" data-fps="30" ` +
  `style="position:relative;width:1080px;height:1920px;overflow:hidden">`;
const STAGE_CLOSE = `</div>`;

// Bypass 1: the mandatory stage itself carries position:relative + overflow:hidden. A bare asset
// image directly inside it must NOT be able to lean on the stage's own styling as crop evidence.
test("a bare asset img directly inside the real stage fails", () => {
  const html = `${STAGE_OPEN}<img src="./assets/shot.png">${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /shot\.png/);
  assert.match(r.reason ?? "", /crop|scal/i);
});

// A genuine crop wrapper: non-stage, overflow:hidden, positioned, and constrained to a size
// smaller than the full 1080x1920 stage — paired with an ENLARGING scale.
test("an asset img in a genuine crop wrapper with an enlarging scale passes", () => {
  const html = `${STAGE_OPEN}
      <div style="position:relative;width:900px;height:1200px;overflow:hidden">
        <img src="./assets/shot.png" style="position:absolute;top:-40px;left:-120px;transform:scale(2.4)">
      </div>
    ${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
});

// Bypass 2: shrinking must never count as cropping — the entire point is enlarging the important
// region. scale(0.2) makes interface text SMALLER, the opposite of the gate's purpose.
test("transform: scale(0.2) inside the real stage fails", () => {
  const html = `${STAGE_OPEN}<img src="./assets/shot.png" style="transform:scale(0.2)">${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /shot\.png/);
});

// scale(1) is not an enlargement either — it is a no-op that must not count as crop intent.
test("transform: scale(1) fails", () => {
  const html = `${STAGE_OPEN}<img src="./assets/shot.png" style="transform:scale(1)">${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /shot\.png/);
});

test("an img with object-fit:cover and explicit width/height passes", () => {
  const html = `${STAGE_OPEN}<img src="./assets/shot.png" style="width:1080px;height:1920px;object-fit:cover">${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
});

test("html with no assets at all passes — nothing to judge", () => {
  const html = `${STAGE_OPEN}<h1>SHIP IT</h1><img src="data:image/png;base64,abc">${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
  assert.equal(r.reason, undefined);
});

test("of multiple images, one cropped and one bare, the SECOND (bare) one fails and is named", () => {
  const html = `${STAGE_OPEN}
      <div style="position:relative;width:400px;height:600px;overflow:hidden">
        <img src="./assets/wrapped.png" style="transform:scale(1.4)">
      </div>
      <img src="./assets/bare.png">
    ${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /bare\.png/);
  assert.doesNotMatch(r.reason ?? "", /wrapped\.png/);
});

// A wrapper that mimics the stage's own geometry (full 1080x1920, overflow:hidden, positioned) is
// not a crop window — it is the stage's contract wearing a different tag, and must not pass.
test("a non-stage wrapper sized to the full 1080x1920 fails", () => {
  const html = `${STAGE_OPEN}
      <div style="position:relative;width:1080px;height:1920px;overflow:hidden">
        <img src="./assets/shot.png">
      </div>
    ${STAGE_CLOSE}`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /shot\.png/);
});

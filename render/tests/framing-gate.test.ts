import test from "node:test";
import assert from "node:assert/strict";
import { checkImageFraming } from "../src/premium/framing-gate.js";

// Real failing shape from production QA: a 2756x1550 desktop capture placed whole into a
// 1080x1920 frame, no wrapper, no scale — the defect this gate exists to catch before a render.
test("a bare <img> referencing an asset with no wrapper fails", () => {
  const html = `<div id="stage"><img src="./assets/shot.png"></div>`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /shot\.png/);
  assert.match(r.reason ?? "", /crop|scal/i);
});

test("an img inside a positioned overflow:hidden wrapper with a transform:scale passes", () => {
  const html = `
    <div id="stage">
      <div style="width:400px;height:600px;overflow:hidden;position:relative">
        <img src="./assets/shot.png" style="position:absolute;top:-40px;left:-120px;transform:scale(1.6)">
      </div>
    </div>
  `;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
});

test("an img with object-fit:cover and explicit width/height passes", () => {
  const html = `<div id="stage"><img src="./assets/shot.png" style="width:1080px;height:1920px;object-fit:cover"></div>`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
});

test("html with no assets at all passes — nothing to judge", () => {
  const html = `<div id="stage"><h1>SHIP IT</h1><img src="data:image/png;base64,abc"></div>`;
  const r = checkImageFraming(html);
  assert.equal(r.ok, true);
  assert.equal(r.reason, undefined);
});

test("of multiple images, one cropped and one bare, the bare one fails and is named", () => {
  const html = `
    <div id="stage">
      <div style="width:400px;height:600px;overflow:hidden;position:relative">
        <img src="./assets/wrapped.png" style="transform:scale(1.4)">
      </div>
      <img src="./assets/bare.png">
    </div>
  `;
  const r = checkImageFraming(html);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /bare\.png/);
  assert.doesNotMatch(r.reason ?? "", /wrapped\.png/);
});

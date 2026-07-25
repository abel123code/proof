import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePresentationContract } from "../src/premium/presentation-contract.js";
import type { SceneSpec } from "../src/types.js";

const overlaySpec = (): SceneSpec => ({
  id: "scene-1",
  anchorMs: 1000,
  durMs: 2500,
  mode: "overlay",
  backgroundTreatment: "footage",
  priority: 80,
  rationale: "A concise claim belongs over the speaker.",
  motif: "one transforming line",
  visualPurpose: "claim",
  headline: "THE RESULT IS ALREADY HERE",
  supportingVisual: "One line connecting the claim to a supplied proof asset.",
  intent: "Keep the speaker visible and support the claim with one integrated diagram.",
  captionText: "The result is already here in the work.",
});

test("presentation contract accepts a marked headline-led footage overlay", () => {
  const html = `
    <div id="stage" data-visual-purpose="claim">
      <h1 data-scene-headline>THE RESULT IS ALREADY HERE</h1>
      <div data-supporting-visual aria-label="proof connection"></div>
    </div>`;

  assert.deepEqual(validatePresentationContract(html, overlaySpec()), []);
});

test("presentation contract rejects icon-only substitutions for required overlay headlines", () => {
  const html = `
    <div id="stage" data-visual-purpose="claim">
      <div data-supporting-visual aria-label="question">?</div>
    </div>`;

  const violations = validatePresentationContract(html, overlaySpec());
  assert.ok(violations.some((violation) => /required headline/i.test(violation)));
});

test("presentation contract keeps overlays on footage and permits either full-frame background", () => {
  const invalidOverlay = { ...overlaySpec(), backgroundTreatment: "black" as const };
  assert.ok(validatePresentationContract("<div id=\"stage\"></div>", invalidOverlay).some((v) => /footage/i.test(v)));

  const footageTakeover: SceneSpec = {
    ...overlaySpec(),
    mode: "full-frame",
    backgroundTreatment: "footage",
    visualPurpose: "process",
    headline: undefined,
  };
  const blackTakeover = { ...footageTakeover, backgroundTreatment: "black" as const };
  assert.ok(!validatePresentationContract("<div id=\"stage\" data-visual-purpose=\"process\"></div>", footageTakeover)
    .some((v) => /footage|black/i.test(v)));
  assert.ok(!validatePresentationContract("<div id=\"stage\" data-visual-purpose=\"process\"></div>", blackTakeover)
    .some((v) => /footage|black/i.test(v)));
});

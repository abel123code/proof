import test from "node:test";
import assert from "node:assert/strict";
import { checkInvention } from "../src/premium/invention-gate.js";

/**
 * A scene holds two kinds of text. Its own editorial copy ("ONE CLEAN LIST.") belongs to no
 * screenshot and is the author's to write. A reconstruction of a real product UI must say exactly
 * what the screenshot said. The author marks the second kind with data-ui-source, and only that is
 * policed here.
 *
 * This runs before the vision QA because it is deterministic. A wrong course code is a string
 * comparison; a model asked to spot one will sometimes look straight at "10.018" beside a record
 * saying "10.016" and call the frame fine.
 */

const records = {
  "shot.png": {
    items: [
      { text: "Deadline Center", region: "header", legible: true },
      { text: "10.016 - Science for a Sustainable World", region: "list", legible: true },
      { text: "SSW Homework 1", region: "list", legible: true },
      { text: "0?.0?? Professional Practice", region: "list", legible: false },
    ],
  },
};

const wrap = (inner: string) =>
  `<div id="stage"><h1>ONE CLEAN LIST.</h1><div data-ui-source="shot.png">${inner}</div></div>`;

test("passes a reconstruction whose text all came from the record", () => {
  const html = wrap(`<div>Deadline Center</div><div>SSW Homework 1</div>`);
  assert.equal(checkInvention(html, records).ok, true);
});

test("allows the scene's own headline outside the reconstruction", () => {
  assert.equal(checkInvention(wrap(`<div>Deadline Center</div>`), records).ok, true);
});

test("fails a course code that was never on screen", () => {
  const out = checkInvention(wrap(`<div>10.018 - Modeling Space and Systems</div>`), records);

  assert.equal(out.ok, false);
  assert.ok(out.invented.includes("10.018 - Modeling Space and Systems"));
});

test("fails a near-miss digit, which is the whole reason this gate exists", () => {
  const html = wrap(`<div>10.018 - Science for a Sustainable World</div>`);
  assert.equal(checkInvention(html, records).ok, false);
});

test("fails text the extractor marked illegible, so nothing is guessed", () => {
  // The record holds "0?.0?? Professional Practice" with legible:false. Completing it into a real
  // course code is exactly the invention this prevents.
  assert.equal(checkInvention(wrap(`<div>01.011 Professional Practice</div>`), records).ok, false);
});

test("ignores case and surrounding whitespace when matching", () => {
  assert.equal(checkInvention(wrap(`<div>  deadline center  </div>`), records).ok, true);
});

test("accepts a fragment of a recorded string, since a row is often split across spans", () => {
  const html = wrap(`<span>10.016</span><span>Science for a Sustainable World</span>`);
  assert.equal(checkInvention(html, records).ok, true);
});

test("rejects a reconstruction pointing at a file with no extracted text", () => {
  const html = `<div id="stage"><div data-ui-source="unknown.png"><div>Anything</div></div></div>`;
  const out = checkInvention(html, records);

  assert.equal(out.ok, false);
  assert.match(out.reason ?? "", /no extracted text/i);
});

test("passes HTML with no reconstruction at all", () => {
  assert.equal(checkInvention(`<div id="stage"><h1>A HEADLINE</h1></div>`, records).ok, true);
});

test("ignores script and style contents, which are code and not on-screen text", () => {
  const html = wrap(`<style>.x{content:"10.018"}</style><div>Deadline Center</div>`);
  assert.equal(checkInvention(html, records).ok, true);
});

test("polices every reconstruction when a scene rebuilds two screenshots", () => {
  const two = {
    ...records,
    "other.png": { items: [{ text: "Export", region: "button", legible: true }] },
  };
  const html =
    `<div id="stage">` +
    `<div data-ui-source="shot.png"><div>Deadline Center</div></div>` +
    `<div data-ui-source="other.png"><div>Import</div></div>` +
    `</div>`;
  const out = checkInvention(html, two);

  assert.equal(out.ok, false);
  assert.ok(out.invented.includes("Import"));
});

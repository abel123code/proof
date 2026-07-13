import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scriptToVocabPrompt } from "../src/transcribe.js";
import { normalizeScenes } from "../src/premium/scenes.js";
import { validateComposition } from "../src/premium/sanitize.js";
import { produceScene } from "../src/premium/index.js";
import { parseQaVerdict } from "../src/premium/qa.js";
import type { SceneSpec } from "../src/types.js";

const VALID_HTML = `<!doctype html><html><head></head><body>
<div id="stage" data-composition-id="scene-1" data-width="1080" data-height="1920" data-fps="30"></div>
<script src="./gsap.min.js"></script>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines = { "scene-1": tl };</script>
</body></html>`;

const spec = (id: string): SceneSpec => ({
  id,
  anchorMs: 0,
  durMs: 2000,
  motif: "chip",
  intent: "show the thing",
  captionText: "the thing",
});

test("vocab prompt mines product names / acronyms / camelCase + keyword flags, deduped", () => {
  const v = scriptToVocabPrompt(
    "We ship with Next.js and Trigger.dev into the SUTD eDimension portal.",
    ["Gradescope", "AI SEO"],
  );
  assert.ok(v, "expected a vocab hint");
  for (const term of ["Next.js", "Trigger.dev", "SUTD", "eDimension", "Gradescope", "AI SEO"]) {
    assert.ok(v!.includes(term), `vocab hint missing "${term}": ${v}`);
  }
});

test("vocab prompt ignores plain sentence-initial capitals and returns undefined when empty", () => {
  // "We"/"The" are sentence-initial caps, not product names — nothing to hint.
  assert.equal(scriptToVocabPrompt("We shipped the thing today.", []), undefined);
});

test("normalizeScenes snaps anchors to word starts, clamps durations, drops overlaps", () => {
  const wordStarts = [0, 500, 1200, 2000, 3000, 4200, 5000];
  const raw = [
    { anchorMs: 480, durMs: 100, intent: "snaps to 0; 100ms clamped up to the 1500ms floor" },
    { anchorMs: 1250, durMs: 3000, intent: "snaps to 1200 which overlaps the first scene -> dropped" },
    { anchorMs: 2100, durMs: 9000, intent: "snaps to 2000; 9000ms clamped, tail clamped to total" },
  ];

  const out = normalizeScenes(raw, wordStarts, "chip-motif", 6000);

  assert.equal(out.length, 2, "the overlapping middle scene is dropped");
  assert.equal(out[0].anchorMs, 0);
  assert.equal(out[0].durMs, 1500, "sub-floor duration is raised to 1500ms");
  assert.equal(out[0].id, "scene-1");
  assert.equal(out[1].anchorMs, 2000);
  assert.equal(out[1].durMs, 4000, "duration clamped so the scene ends at totalMs (6000)");
  assert.equal(out[1].id, "scene-2");
  assert.equal(out[0].motif, "chip-motif");
});

test("normalizeScenes rejects scenes anchored at/after the video end", () => {
  const out = normalizeScenes(
    [{ anchorMs: 9000, durMs: 2000, intent: "past the end" }],
    [0, 1000, 9000],
    "m",
    5000,
  );
  assert.equal(out.length, 0);
});

test("validateComposition accepts a local, network-free composition", () => {
  const html = `${VALID_HTML}<img src="./assets/ui.png"><style>.x{background:url(data:image/png;base64,AAAA)}</style>`;
  assert.deepEqual(validateComposition(html, ["ui.png"]), []);
});

test("validateComposition rejects external URLs, protocol-relative refs, and network/eval APIs", () => {
  assert.ok(
    validateComposition(`<div id="stage"></div><script src="https://cdn/x.js"></script>`, []).some((v) =>
      /external URL/.test(v),
    ),
  );
  assert.ok(
    validateComposition(`<div id="stage"></div><img src="//evil/x.png">`, []).some((v) => /external URL/.test(v)),
  );
  assert.ok(
    validateComposition(`<div id="stage"></div><script>fetch("/x")</script>`, []).some((v) =>
      /network API/.test(v),
    ),
  );
  assert.ok(
    validateComposition(`<div id="stage"></div><script>eval("1")</script>`, []).some((v) => /eval/.test(v)),
  );
});

test("validateComposition does not flag the word 'fetch'/'import' in visible copy", () => {
  const html = `<div id="stage"><h1>fetch your repo, import it, then ship</h1></div><script src="./gsap.min.js"></script>`;
  assert.deepEqual(validateComposition(html, []), []);
});

test("validateComposition flags a missing #stage and unknown asset references", () => {
  const v = validateComposition(`<div><img src="./assets/unknown.png"></div>`, ["known.png"]);
  assert.ok(v.some((x) => /#stage/.test(x)));
  assert.ok(v.some((x) => /unknown asset/.test(x)));
});

test("validateComposition catches parser-level bypasses (unquoted, srcset, srcdoc, meta, @import, iframe, traversal)", () => {
  const cases: [string, RegExp][] = [
    [`<div id="stage"></div><script src=https://evil/x.js></script>`, /external URL/], // unquoted attr
    [`<div id="stage"></div><img srcset="//cdn/a.png 1x">`, /external URL/], // protocol-relative in srcset
    [`<div id="stage"></div><div srcdoc="<b>x"></div>`, /srcdoc/],
    [`<div id="stage"></div><meta http-equiv="refresh" content="0;url=https://e/">`, /meta refresh/],
    [`<div id="stage"></div><style>@import "https://f/c.css";</style>`, /external URL/],
    [`<div id="stage"></div><iframe></iframe>`, /forbidden <iframe>/],
    [`<div id="stage"></div><link rel="stylesheet" href="https://f/c.css">`, /forbidden <link>/],
    [`<div id="stage"></div><img src="./assets/../../etc/passwd">`, /traversal/],
    [`<div id="stage"></div><a href="javascript:alert(1)">x</a>`, /external URL/],
  ];
  for (const [html, re] of cases) {
    const v = validateComposition(html, []);
    assert.ok(v.some((x) => re.test(x)), `expected ${re} for: ${html}\n got: ${JSON.stringify(v)}`);
  }
});

test("parseQaVerdict fails CLOSED on empty or unparseable responses", () => {
  assert.equal(parseQaVerdict(undefined).ok, false);
  assert.equal(parseQaVerdict("").ok, false);
  assert.equal(parseQaVerdict("not json {").ok, false);
  // valid but rejecting
  const rejected = parseQaVerdict(JSON.stringify({ ok: false, issues: ["clipped title"] }));
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.issues, ["clipped title"]);
  // ok:true but with issues -> still not approved
  assert.equal(parseQaVerdict(JSON.stringify({ ok: true, issues: ["tiny text"] })).ok, false);
  // clean approval
  assert.equal(parseQaVerdict(JSON.stringify({ ok: true, issues: [] })).ok, true);
});

test("produceScene skips (no movPath) when QA rejects through the final retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    let authored = 0;
    let rendered = 0;
    const out = await produceScene(
      {
        spec: spec("scene-1"),
        brief: { script: "", keywordFlags: [] },
        assetHints: [],
        assetsDir: dir,
        premiumDir: dir,
        basePath: "base.mp4",
        fps: 30,
        log: () => {},
      },
      {
        author: async () => {
          authored++;
          return VALID_HTML;
        },
        render: async () => {
          rendered++;
        },
        qa: async () => ({ ok: false, issues: ["unreadable text"] }),
      },
    );
    assert.equal(out.movPath, undefined, "a QA-rejected scene must not carry a movPath");
    assert.equal(authored, 3, "author runs for the initial attempt + 2 retries");
    assert.equal(rendered, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene returns a movPath when QA approves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    const out = await produceScene(
      {
        spec: spec("scene-2"),
        brief: { script: "", keywordFlags: [] },
        assetHints: [],
        assetsDir: dir,
        premiumDir: dir,
        basePath: "base.mp4",
        fps: 30,
        log: () => {},
      },
      { author: async () => VALID_HTML, render: async () => {}, qa: async () => ({ ok: true, issues: [] }) },
    );
    assert.equal(out.movPath, join(dir, "scene-2.mov"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene never renders unsafe model HTML (external script) and skips it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    let rendered = 0;
    const out = await produceScene(
      {
        spec: spec("scene-3"),
        brief: { script: "", keywordFlags: [] },
        assetHints: [],
        assetsDir: dir,
        premiumDir: dir,
        basePath: "base.mp4",
        fps: 30,
        log: () => {},
      },
      {
        author: async () => `<div id="stage"></div><script src="https://evil.example/x.js"></script>`,
        render: async () => {
          rendered++;
        },
        qa: async () => ({ ok: true, issues: [] }),
      },
    );
    assert.equal(out.movPath, undefined, "unsafe HTML must never get a movPath");
    assert.equal(rendered, 0, "unsafe HTML must never reach the renderer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

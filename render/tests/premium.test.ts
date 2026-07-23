import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scriptToVocabPrompt } from "../src/transcribe.js";
import {
  DEFAULT_PREMIUM_PLAN_MODEL,
  normalizeScenes,
  planScenes,
  findAnchorMs,
  buildSceneIntent,
  scenesFromBrief,
} from "../src/premium/scenes.js";
import {
  DEFAULT_PREMIUM_AUTHOR_MODEL,
  authorSystemPrompt,
} from "../src/premium/author.js";
import { validateComposition } from "../src/premium/sanitize.js";
import { produceScene } from "../src/premium/index.js";
import {
  DEFAULT_PREMIUM_QA_MODEL,
  parseQaVerdict,
  qaImagePart,
  qaSampleTimes,
  qaSystemPrompt,
} from "../src/premium/qa.js";
import {
  DEFAULT_PREMIUM_OPENAI_TIMEOUT_MS,
  chatTuning,
  isReasoningModel,
  normalizeEffort,
  premiumRequestOptions,
} from "../src/premium/model-params.js";
import { DEFAULT_BRIEF_VISUAL_MODEL } from "../src/visual-planner.js";
import { maskOverlaySafeZones, SPEAKER_SAFE_ALPHA_FILTER } from "../src/ffmpeg.js";
import type { SceneSpec, RenderBrief, Word } from "../src/types.js";

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
  assert.deepEqual(parseQaVerdict(JSON.stringify({ ok: false, issues: [] })).issues, [
    "QA rejected the scene without reasons",
  ]);
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
        mask: async () => {},
        qa: async () => ({ ok: false, issues: ["unreadable text"] }),
      },
    );
    assert.equal(out.movPath, undefined, "a QA-rejected scene must not carry a movPath");
    // MAX_QA_ITERS defaults to 2 -> initial attempt + 2 retries.
    assert.equal(authored, 3, "author runs for the initial attempt + 2 retries");
    assert.equal(rendered, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene returns a movPath when QA approves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    const order: string[] = [];
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
      {
        author: async () => VALID_HTML,
        render: async () => { order.push("render"); },
        mask: async () => { order.push("mask"); },
        qa: async () => {
          order.push("qa");
          return { ok: true, issues: [] };
        },
      },
    );
    assert.equal(out.movPath, join(dir, "scene-2.mov"));
    assert.deepEqual(order, ["render", "mask", "qa"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene sends concrete QA issues into the next author attempt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    const seen: Array<string[] | undefined> = [];
    let reviews = 0;
    const out = await produceScene(
      {
        spec: spec("scene-feedback"),
        brief: { script: "", keywordFlags: [] },
        assetHints: [],
        assetsDir: dir,
        premiumDir: dir,
        basePath: "base.mp4",
        fps: 30,
        log: () => {},
      },
      {
        author: async ({ priorIssues }) => {
          seen.push(priorIssues);
          return VALID_HTML;
        },
        render: async () => {},
        mask: async () => {},
        qa: async () => {
          reviews++;
          return reviews === 1
            ? { ok: false, issues: ["move the title away from the speaker's face"] }
            : { ok: true, issues: [] };
        },
      },
    );

    assert.equal(out.movPath, join(dir, "scene-feedback.mov"));
    assert.deepEqual(seen, [undefined, ["move the title away from the speaker's face"]]);
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
        mask: async () => {},
        qa: async () => ({ ok: true, issues: [] }),
      },
    );
    assert.equal(out.movPath, undefined, "unsafe HTML must never get a movPath");
    assert.equal(rendered, 0, "unsafe HTML must never reach the renderer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- model-params (Task 1) ----

test("isReasoningModel: gpt-5.x and o-series are reasoning models; gpt-4o is not", () => {
  for (const m of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "o3", "o4-mini"]) {
    assert.equal(isReasoningModel(m), true, `${m} should be a reasoning model`);
  }
  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1"]) {
    assert.equal(isReasoningModel(m), false, `${m} should NOT be a reasoning model`);
  }
});

test("normalizeEffort accepts the API values and rejects invalid configuration", () => {
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"] as const) {
    assert.equal(normalizeEffort(effort.toUpperCase()), effort);
  }
  assert.equal(normalizeEffort(undefined), "low");
  assert.equal(normalizeEffort(""), "low");
  assert.throws(() => normalizeEffort("minimal"), /Invalid PREMIUM reasoning effort/);
  assert.throws(() => normalizeEffort("turbo"), /Invalid PREMIUM reasoning effort/);
});

test("chatTuning: reasoning models get reasoning_effort and NO temperature; legacy models get neither", () => {
  assert.deepEqual(chatTuning("gpt-5.4", "medium"), { reasoning_effort: "medium" });
  assert.deepEqual(chatTuning("gpt-5.4", undefined), { reasoning_effort: "low" });
  assert.deepEqual(chatTuning("gpt-5.6-luna", "none"), { reasoning_effort: "none" });
  assert.deepEqual(chatTuning("gpt-5.6-sol", "max"), { reasoning_effort: "max" });
  assert.deepEqual(chatTuning("gpt-4o", "medium"), {}); // no temperature key at all
  assert.equal("temperature" in chatTuning("gpt-5.4", "low"), false);
});

test("premium model defaults use GPT-5.6 tiers by workload role", () => {
  assert.equal(DEFAULT_PREMIUM_PLAN_MODEL, "gpt-5.6-sol");
  assert.equal(DEFAULT_PREMIUM_AUTHOR_MODEL, "gpt-5.6-sol");
  assert.equal(DEFAULT_PREMIUM_QA_MODEL, "gpt-5.6-sol");
  assert.equal(DEFAULT_BRIEF_VISUAL_MODEL, "gpt-5.6-luna");
});

test("premium model calls have a bounded deadline and one transient retry", () => {
  assert.equal(DEFAULT_PREMIUM_OPENAI_TIMEOUT_MS, 90_000);
  assert.deepEqual(premiumRequestOptions(undefined), {
    timeout: 90_000,
    maxRetries: 1,
  });
  assert.deepEqual(premiumRequestOptions("45000"), {
    timeout: 45_000,
    maxRetries: 1,
  });
  assert.deepEqual(premiumRequestOptions("bad"), {
    timeout: 90_000,
    maxRetries: 1,
  });
});

test("the deterministic overlay mask clears the moving-speaker and caption zones", () => {
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /x=160:y=180:w=760:h=1070/);
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /x=0:y=1450:w=iw:h=470/);
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /black@0/);
});

test("the FFmpeg mask clears protected alpha pixels and preserves permitted pixels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-mask-"));
  const overlay = join(dir, "overlay.mov");
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "color=c=white@1:s=1080x1920:r=1:d=1",
      "-vf", "format=rgba",
      "-frames:v", "1",
      "-c:v", "prores_ks",
      "-profile:v", "4",
      "-pix_fmt", "yuva444p10le",
      overlay,
    ]);

    await maskOverlaySafeZones(overlay);

    const alphaAt = (x: number, y: number): number => {
      const pixel = execFileSync(ffmpeg, [
        "-loglevel", "error", "-i", overlay,
        "-vf", `alphaextract,crop=1:1:${x}:${y}`,
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "gray",
        "pipe:1",
      ]);
      return pixel[0];
    };

    assert.equal(alphaAt(500, 500), 0, "speaker corridor must be transparent");
    assert.equal(alphaAt(500, 1500), 0, "caption band must be transparent");
    assert.ok(alphaAt(80, 100) >= 250, "header-safe pixels must stay opaque");
    assert.ok(alphaAt(500, 1300) >= 250, "lower permitted pixels must stay opaque");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vision QA sends explicit full-detail frames and samples scene boundaries", () => {
  const image = qaImagePart("data:image/png;base64,AAAA");
  assert.equal(image.type, "image_url");
  assert.equal(image.image_url.detail, "auto");
  assert.deepEqual(qaSampleTimes(4), [0.2, 0.8, 2, 3.4, 3.8]);
});

test("the author contract composes in wide top/bottom bands, not narrow side rails", () => {
  const prompt = authorSystemPrompt(3);
  // Gold-standard layout language (proof-demo-FINAL): a wide top band above the head and a
  // full-width lower panel over the chest — NOT two narrow vertical rails, which read as a
  // cramped HUD and were the thing the first fix wrongly prescribed.
  assert.match(prompt, /top band above the head/);
  assert.match(prompt, /FULL-WIDTH panel in the lower band/);
  assert.match(prompt, /Do NOT build two narrow vertical side rails/);
  // The face must never be covered by an OPAQUE block, but transparent accents may cross it.
  assert.match(prompt, /NEVER cover the eyes, nose or mouth with\s+an OPAQUE block/);
  assert.match(prompt, /Transparent, non-blocking accents/);
  // Caption band stays protected.
  assert.match(prompt, /y=1450\.\.1920/);
});

test("QA may only demand assets that were actually staged", () => {
  const withAssets = qaSystemPrompt(["hero.png", "logo.png"]);
  assert.match(withAssets, /hero\.png, logo\.png/);
  assert.match(withAssets, /Demand ONLY assets from/);

  // The zero-asset case is what broke the before-run: QA demanded a real GitHub commit-graph
  // screenshot and the actual screen recording, neither of which was ever staged, so no
  // re-author could satisfy it and the scene burned every retry.
  const noAssets = qaSystemPrompt([]);
  assert.match(noAssets, /NO assets are staged/);
  assert.match(noAssets, /demand real screenshots, recordings, photos or logos/);
  assert.match(noAssets, /recreated UI/);
  // ...and the example fixes must not suggest embedding a file that does not exist
  assert.doesNotMatch(noAssets, /\.\/assets\//);
  assert.doesNotMatch(noAssets, /hero\.png/);
});

// ---- brief.scenes -> SceneSpec (Task 3) ----

const words = (pairs: Array<[number, string]>): Word[] =>
  pairs.map(([startMs, text]) => ({ text, startMs, endMs: startMs + 300 }));

test("findAnchorMs matches the spoken line's opening words to a word-start", () => {
  const w = words([[0, "We"], [300, "built"], [600, "a"], [900, "deadline"], [1200, "tracker"]]);
  assert.equal(findAnchorMs("built a deadline", w), 300);
  assert.equal(findAnchorMs("nowhere in here", w), null); // no token overlap -> null
});

test("buildSceneIntent bakes brollCue + headline + asset filenames into one directive", () => {
  const intent = buildSceneIntent(
    { label: "payoff", spokenLine: "and it's live", onScreenText: "SHIP IT", brollCue: "the popup slides up into a phone frame" },
    ["main-view.png"],
  );
  assert.match(intent, /popup slides up/);
  assert.match(intent, /SHIP IT/);
  assert.match(intent, /main-view\.png/);
  assert.match(intent, /headline-only card is NOT acceptable/i);
});

test("scenesFromBrief anchors each brief scene to the timeline and honors the motif", () => {
  const w = words([[0, "problem"], [1000, "platforms"], [3000, "manual"], [4000, "burden"], [6000, "done"]]);
  const brief = {
    script: "x", keywordFlags: [],
    assets: { motif: "an accent chip that transforms" },
    scenes: [
      { label: "a", spokenLine: "problem platforms", onScreenText: "PLATFORMS", brollCue: "logos rain in", durationSeconds: 2 },
      { label: "b", spokenLine: "manual burden", onScreenText: "MANUAL", brollCue: "a stack of tasks piles up", durationSeconds: 2 },
    ],
  } as RenderBrief;
  const specs = scenesFromBrief({ brief, words: w, durationMs: 8000, assetHints: [] });
  assert.equal(specs.length, 2);
  assert.equal(specs[0].anchorMs, 0);
  assert.equal(specs[1].anchorMs, 3000);
  assert.equal(specs[0].motif, "an accent chip that transforms");
  assert.match(specs[0].intent, /logos rain in/);
  assert.equal(specs[0].captionText, "problem platforms");
});

// ---- planScenes prefers brief.scenes (Task 4) ----

test("planScenes uses the brief's own scenes without calling the LLM when they exist", async () => {
  const w = words([[0, "problem"], [1000, "platforms"], [3000, "manual"], [4000, "burden"]]);
  const brief = {
    script: "x", keywordFlags: [],
    scenes: [{ label: "a", spokenLine: "problem platforms", onScreenText: "PLATFORMS", brollCue: "logos rain in" }],
  } as RenderBrief;
  // If this path hit OpenAI it would throw (no key in unit env). It must NOT.
  const specs = await planScenes({ brief, words: w, durationMs: 6000, assetHints: [] });
  assert.equal(specs.length, 1);
  assert.match(specs[0].intent, /logos rain in/);
});

// ---- asset-inclusion gate (Task 6 fix lever 1) ----

import { assetsNamedInIntent, missingAssets } from "../src/premium/assets-gate.js";

test("assetsNamedInIntent returns only the asset filenames the intent actually references", () => {
  const hints = ["edimension.svg", "gradescope.svg", "main-view.png", "calendar-export.png"];
  const intent = "Slam ./assets/edimension.svg top-left and ./assets/gradescope.svg top-right; strings snap.";
  assert.deepEqual(assetsNamedInIntent(intent, hints).sort(), ["edimension.svg", "gradescope.svg"]);
  // a pure-motion beat that names no asset requires none
  assert.deepEqual(assetsNamedInIntent("A red MISSED card punches up. No product asset needed.", hints), []);
  // a bare "available assets" list (buildSceneIntent appends one) must NOT trigger the gate —
  // only path-form (assets/<file>) references count, else the gate demands every asset in every scene.
  assert.deepEqual(assetsNamedInIntent("Available: main-view.png, calendar-export.png, edimension.svg.", hints), []);
});

test("missingAssets flags required assets absent from the HTML (case-insensitive)", () => {
  const html = `<div id="stage"><img src="./assets/edimension.svg"></div>`;
  assert.deepEqual(missingAssets(html, ["edimension.svg", "gradescope.svg"]), ["gradescope.svg"]);
  assert.deepEqual(missingAssets(html, ["edimension.svg"]), []);
  assert.deepEqual(missingAssets(`<img src="./ASSETS/Main-View.PNG">`, ["main-view.png"]), []);
});

// ---- anchor placement preserves all brief scenes (Task 6 fix lever 3) ----

import { placeBriefScenes } from "../src/premium/scenes.js";

test("placeBriefScenes keeps ALL brief scenes, nudging overlaps forward instead of dropping them", () => {
  const raw = [0, 1000, 2000, 2500, 3000, 3500].map((anchorMs, i) => ({
    anchorMs,
    durMs: 3000,
    intent: `scene ${i}`,
    captionText: `line ${i}`,
  }));
  const out = placeBriefScenes(raw, "motif", 30000);
  assert.equal(out.length, 6, "all six overlapping scenes survive");
  // monotonic, non-overlapping, in order
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].anchorMs >= out[i - 1].anchorMs + out[i - 1].durMs, `scene ${i} must not overlap ${i - 1}`);
  }
  assert.equal(out[0].id, "scene-1");
  assert.equal(out[5].id, "scene-6");
  assert.equal(out[0].motif, "motif");
});

test("placeBriefScenes stops adding scenes once the timeline is full (no zero-length tail)", () => {
  const raw = [0, 100, 200].map((anchorMs, i) => ({ anchorMs, durMs: 3000, intent: `s${i}`, captionText: "" }));
  const out = placeBriefScenes(raw, "m", 4000); // only room for ~one 3000ms scene + a floor
  assert.ok(out.length >= 1 && out.length <= 2);
  for (const s of out) assert.ok(s.anchorMs + s.durMs <= 4000);
});

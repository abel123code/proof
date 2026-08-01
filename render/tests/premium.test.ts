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
  planEdit,
  planScenes,
  findAnchorMs,
  buildSceneIntent,
  scenesFromBrief,
} from "../src/premium/scenes.js";
import {
  DEFAULT_PREMIUM_AUTHOR_MODEL,
  authorSystemPrompt,
  buildAuthorMessages,
} from "../src/premium/author.js";
import { validateComposition } from "../src/premium/sanitize.js";
import { missingAssets } from "../src/premium/assets-gate.js";
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
  mode: "overlay",
  priority: 50,
  rationale: "test scene",
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

test("sanitizer rejects executable data: URLs and non-gsap <script src> (allows media data:)", () => {
  // Executable data: URL in a <script src> ran in the render page before this fix.
  assert.ok(
    validateComposition(`<div id="stage"></div><script src="data:text/javascript,alert(1)"></script>`, []).length > 0,
    "executable data: script must be rejected",
  );
  assert.ok(
    validateComposition(`<div id="stage"></div><script src="./assets/evil.js"></script>`, []).length > 0,
    "a non-gsap <script src> must be rejected",
  );
  // Inline media data: and the local gsap script stay allowed.
  assert.deepEqual(
    validateComposition(`<div id="stage"></div><img src="data:image/png;base64,iVBOR"><script src="./gsap.min.js"></script>`, []),
    [],
  );
});

test("missingAssets requires an assets/<name> reference, not a bare filename mention", () => {
  assert.deepEqual(missingAssets(`<img src="./assets/logo.png">`, ["logo.png"]), []);
  assert.deepEqual(missingAssets(`<div style="background:url(assets/logo.png)"></div>`, ["logo.png"]), []);
  assert.deepEqual(missingAssets(`<!-- logo.png -->`, ["logo.png"]), ["logo.png"]); // comment does NOT satisfy
  assert.deepEqual(missingAssets(`<div>logo.png</div>`, ["logo.png"]), ["logo.png"]); // text does NOT satisfy
});

test("parseQaVerdict tags outcomes AND issue kinds; empty/unparseable are operational", () => {
  // Transport/parse failures are OPERATIONAL (re-judge the same render), not a scene verdict.
  assert.equal(parseQaVerdict(undefined).outcome, "operational_error");
  assert.equal(parseQaVerdict("").outcome, "operational_error");
  assert.equal(parseQaVerdict("not json {").outcome, "operational_error");
  // no issues -> clean approval
  assert.equal(parseQaVerdict(JSON.stringify({ issues: [] })).outcome, "approved");
  // tagged issues -> editorial_reject, kinds preserved verbatim
  const v = parseQaVerdict(
    JSON.stringify({
      issues: [
        { text: "graphic covers the eye", kind: "safety" },
        { text: "badge copy could read 'EDITED BY PROOF'", kind: "subjective" },
      ],
    }),
  );
  assert.equal(v.outcome, "editorial_reject");
  assert.deepEqual(v.issues, [
    { text: "graphic covers the eye", kind: "safety" },
    { text: "badge copy could read 'EDITED BY PROOF'", kind: "subjective" },
  ]);
  // a bare string issue is tolerated and defaults to subjective (never a wrong auto-repair)
  assert.deepEqual(parseQaVerdict(JSON.stringify({ issues: ["tiny text"] })).issues, [
    { text: "tiny text", kind: "subjective" },
  ]);
  // a missing/invalid kind defaults to subjective (fail toward showing the human)
  assert.equal(parseQaVerdict(JSON.stringify({ issues: [{ text: "hmm" }] })).issues[0].kind, "subjective");
  assert.equal(parseQaVerdict(JSON.stringify({ issues: [{ text: "x", kind: "bogus" }] })).issues[0].kind, "subjective");
});

test("produceScene ships FLAGGED (never omits) when a SAFETY issue survives the retry budget", async () => {
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
        captionCheck: async () => false,
        qa: async () => ({ outcome: "editorial_reject", issues: [{ text: "graphic covers the nose", kind: "safety" }] }),
      },
    );
    // NEW CONTRACT: a scene is never silently omitted — it ships flagged with the unresolved reason.
    assert.equal(out.movPath, join(dir, "scene-1.mov"), "a scene always ships now — never omitted");
    assert.equal(out.report.verdict, "flagged");
    assert.equal(out.report.shipped, true);
    assert.ok(out.report.issues.some((i) => i.kind === "safety"), "the unresolved safety reason travels with the scene");
    // MAX_QA_ITERS defaults to 2 -> a safety issue drives the initial attempt + 2 patch attempts.
    assert.equal(authored, 3, "author runs for the initial attempt + 2 safety patches");
    assert.equal(rendered, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene ships a SUBJECTIVE-only reject as-is (flagged), never patching or blocking", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-"));
  try {
    let authored = 0;
    let rendered = 0;
    const out = await produceScene(
      {
        spec: spec("scene-sub"),
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
        captionCheck: async () => false,
        qa: async () => ({
          outcome: "editorial_reject",
          issues: [{ text: "the badge copy could read 'EDITED BY PROOF'", kind: "subjective" }],
        }),
      },
    );
    assert.ok(out.movPath, "a subjective note NEVER blocks shipping");
    assert.equal(out.report.verdict, "flagged");
    assert.deepEqual(out.report.issues, [{ text: "the badge copy could read 'EDITED BY PROOF'", kind: "subjective" }]);
    assert.equal(authored, 1, "a subjective note must NOT trigger a re-author");
    assert.equal(rendered, 1);
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
        captionCheck: async () => { order.push("caption"); return false; },
        qa: async () => {
          order.push("qa");
          return { outcome: "approved", issues: [] };
        },
      },
    );
    assert.equal(out.movPath, join(dir, "scene-2.mov"));
    assert.equal(out.report.verdict, "clean", "an approved scene ships clean, no flags");
    assert.deepEqual(out.report.issues, []);
    assert.deepEqual(order, ["render", "mask", "caption", "qa"]);
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
        captionCheck: async () => false,
        qa: async () => {
          reviews++;
          return reviews === 1
            ? { outcome: "editorial_reject", issues: [{ text: "move the title away from the speaker's face", kind: "safety" }] }
            : { outcome: "approved", issues: [] };
        },
      },
    );

    assert.equal(out.movPath, join(dir, "scene-feedback.mov"));
    // A safety issue drives the patch; the next author call receives its text (only safety patches).
    assert.deepEqual(seen, [undefined, ["move the title away from the speaker's face"]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("produceScene never renders unsafe model HTML (external script) — base_fallback, no movPath", async () => {
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
        captionCheck: async () => false,
        qa: async () => ({ outcome: "approved", issues: [] }),
      },
    );
    assert.equal(out.movPath, undefined, "unsafe HTML can't render -> base_fallback carries no movPath");
    assert.equal(out.report.verdict, "base_fallback", "the ONE non-ship case: no safe render exists");
    assert.equal(out.report.shipped, false);
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

test("the deterministic overlay mask protects captions without erasing face-overlapping graphics", () => {
  assert.doesNotMatch(SPEAKER_SAFE_ALPHA_FILTER, /x=160:y=180:w=760:h=1070/);
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

    assert.ok(alphaAt(500, 500) >= 250, "face-overlapping wording must remain rendered");
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

test("the overlay author contract keeps text over the head, pins installed fonts, and rejects dashboard chrome", () => {
  const prompt = authorSystemPrompt(3, "overlay");
  assert.match(prompt, /ONE visual authority that lives OVER THE HEAD/);
  assert.match(prompt, /speaker remains the primary visual/i);
  assert.match(prompt, /y=1450\.\.1920/);
  assert.match(prompt, /y=80\.\.640/);
  assert.match(prompt, /essential wording must use at least 56px/i);
  assert.match(prompt, /readability wins/i);
  assert.match(prompt, /may overlap the speaker's face/i);
  assert.match(prompt, /no dashboards/i);
  // installed-font pin: reliable stack required, distorting display faces forbidden.
  assert.match(prompt, /Liberation Sans/);
  assert.match(prompt, /NEVER use Impact, Haettenschweiler/i);
  assert.match(prompt, /font-stretch:condensed/i);
  assert.doesNotMatch(prompt, /small dashboard/i);
  assert.doesNotMatch(prompt, /timeline\/waveform strip/i);
});

test("produceScene keeps blackout scenes transparent, skips masking, and checks captions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "premium-full-frame-"));
  try {
    const order: string[] = [];
    const fullFrameSpec = {
      ...spec("scene-full"),
      mode: "full-frame" as const,
      backgroundTreatment: "black" as const,
    };
    const out = await produceScene(
      {
        spec: fullFrameSpec,
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
        captionCheck: async () => { order.push("caption"); return false; },
        qa: async () => {
          order.push("qa");
          return { outcome: "approved", issues: [] };
        },
      },
    );
    assert.equal(out.report.mode, "full-frame");
    assert.equal(out.report.backgroundTreatment, "black");
    assert.deepEqual(order, ["render", "caption", "qa"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the blackout author contract gives the animation visual authority without painting its own background", () => {
  const prompt = authorSystemPrompt(3, "full-frame", "black");
  assert.match(prompt, /solid black background is supplied by the compositor/i);
  assert.match(prompt, /keep html, body, and #stage transparent/i);
  assert.match(prompt, /speaker is intentionally hidden/i);
  assert.match(prompt, /35-50% negative space/i);
  assert.match(prompt, /one claim or relationship/i);
  assert.doesNotMatch(prompt, /NEVER cover a face feature/);
});

test("the footage-backed full-frame contract keeps wording readable without a hard face mask", () => {
  const prompt = authorSystemPrompt(3, "full-frame", "footage");
  assert.match(prompt, /keep html, body, and #stage transparent/i);
  assert.match(prompt, /speaker remains visible/i);
  assert.match(prompt, /face overlap is allowed/i);
  assert.match(prompt, /at least 56px/i);
  assert.match(prompt, /readability wins/i);
  assert.doesNotMatch(prompt, /opaque full-frame canvas/i);
});

test("QA is an auditable advisor that tags each issue safety|subjective (never a silent gatekeeper)", () => {
  const p = qaSystemPrompt([], "overlay");
  // The core of the model: advise + tag, never block. The scene ships regardless.
  assert.match(p, /ADVISOR, not a gatekeeper/i);
  assert.match(p, /the scene WILL ship/i);
  assert.match(p, /tag each one as "safety" or "subjective"/i);
  // SAFETY = objective faults that get auto-repaired.
  assert.match(p, /SAFETY = an OBJECTIVE defect/i);
  assert.match(p, /missing, clipped, partially erased, or unreadably small/i);
  assert.match(p, /at least 56px/i);
  assert.match(p, /face overlap is allowed/i);
  assert.doesNotMatch(p, /Covering even ONE eye counts/);
  assert.match(p, /caption band/i);
  // SUBJECTIVE = matters of taste that NEVER block — incl. copy/word-order preferences.
  assert.match(p, /SUBJECTIVE = a matter of TASTE/i);
  assert.match(p, /NEVER a reason to block/i);
  assert.match(p, /word ORDER/i);
  // When unsure, default to subjective (never a wrong auto-repair).
  assert.match(p, /when unsure/i);
  assert.match(p, /tag it "subjective"/i);
  // The old hard-fail-on-slop language is gone; slop is now a subjective note, not a block.
  assert.doesNotMatch(p, /FAIL ONLY for a real quality problem/i);
  assert.doesNotMatch(p, /partial overlap is fine/i);
  // Feedback is concrete edits, not "start over".
  assert.match(p, /CONCRETE EDIT/);
  assert.match(p, /never "start over"/i);
});

test("full-frame QA does not treat intentionally hidden faces as a safety fault", () => {
  const p = qaSystemPrompt([], "full-frame", "black");
  assert.match(p, /speaker is intentionally absent/i);
  assert.match(p, /negative space/i);
  assert.doesNotMatch(p, /Covering even ONE eye counts/);
});

test("footage-backed full-frame QA prioritizes readable graphics over face protection", () => {
  const p = qaSystemPrompt([], "full-frame", "footage");
  assert.match(p, /speaker remains visible/i);
  assert.match(p, /face overlap is allowed/i);
  assert.match(p, /readability wins/i);
  assert.doesNotMatch(p, /actual face feature/i);
});

test("buildAuthorMessages: fresh author is one user turn; patch puts prior HTML as an assistant turn", () => {
  const fresh = buildAuthorMessages({ system: "S", payload: { intent: "x" } });
  assert.deepEqual(fresh.map((m) => m.role), ["system", "user"]);
  assert.match(fresh[1].content, /Author this scene/);

  const patch = buildAuthorMessages({
    system: "S",
    payload: { intent: "show repo graph", motif: "lime chip", brandColor: "#d9ff45", assets: ["hero.png"] },
    priorHtml: "<div id=stage>PRIOR</div>",
    priorIssues: ["move the panel up"],
  });
  assert.deepEqual(patch.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.match(patch[2].content, /PRIOR/); // the model's prior draft is a real assistant turn
  const last = patch[3].content;
  assert.match(last, /preserve unaffected elements/i);
  assert.doesNotMatch(last, /preserve the layout/i);
  assert.match(last, /move the panel up/);
  assert.match(last, /show repo graph/);
  assert.match(last, /#d9ff45/);
  assert.match(last, /hero\.png/);
  assert.doesNotMatch(last, /Author this scene/);
});

test("produceScene chains the EXACT prior HTML into the edit (undefined -> V1 -> V1)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chain-"));
  try {
    const V1 = VALID_HTML.replace("</body>", "<!--V1--></body>");
    const priors: Array<string | undefined> = [];
    let n = 0;
    await produceScene(
      { spec: spec("scene-1"), brief: { script: "s", keywordFlags: [] }, assetHints: [], assetsDir: dir, premiumDir: dir, basePath: "base.mp4", fps: 30, log: () => {} },
      {
        author: async ({ priorHtml }) => { priors.push(priorHtml); return V1; },
        render: async () => {},
        captionCheck: async () => false,
        qa: async () => (++n === 1 ? { outcome: "editorial_reject", issues: [{ text: "move the panel up", kind: "safety" }] } : { outcome: "approved", issues: [] }),
      },
    );
    assert.equal(priors[0], undefined, "first author is fresh");
    assert.equal(priors[1], V1, "the edit receives the EXACT prior render");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("operational_error retries QA on the same render — no re-author, no re-render", async () => {
  const dir = await mkdtemp(join(tmpdir(), "op-"));
  try {
    let a = 0, r = 0, q = 0;
    const out = await produceScene(
      { spec: spec("scene-1"), brief: { script: "s", keywordFlags: [] }, assetHints: [], assetsDir: dir, premiumDir: dir, basePath: "base.mp4", fps: 30, log: () => {} },
      {
        author: async () => { a++; return VALID_HTML; },
        render: async () => { r++; },
        captionCheck: async () => false,
        qa: async () => (++q === 1 ? { outcome: "operational_error", issues: [{ text: "unparseable", kind: "subjective" }] } : { outcome: "approved", issues: [] }),
      },
    );
    assert.ok(out.movPath, "approved after the QA retry");
    assert.equal(a, 1, "a transport error must NOT re-author");
    assert.equal(r, 1, "a transport error must NOT re-render");
    assert.equal(q, 2, "QA was retried against the same render");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onAttempt fires once per rendered attempt with the tagged outcome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "onatt-"));
  try {
    const outcomes: string[] = [];
    let n = 0;
    await produceScene(
      {
        spec: spec("scene-1"), brief: { script: "s", keywordFlags: [] }, assetHints: [],
        assetsDir: dir, premiumDir: dir, basePath: "b.mp4", fps: 30, log: () => {},
        onAttempt: async (r) => { outcomes.push(r.outcome); },
      },
      {
        author: async () => VALID_HTML,
        render: async () => {},
        captionCheck: async () => false,
        qa: async () => (++n === 1 ? { outcome: "editorial_reject", issues: [{ text: "move it", kind: "safety" }] } : { outcome: "approved", issues: [] }),
      },
    );
    assert.deepEqual(outcomes, ["editorial_reject", "approved"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  assert.match(intent, /one bespoke, intentional visual authority/i);
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

test("planEdit always invokes the global editorial planner even when brief scenes exist", async () => {
  const w = words([[0, "problem"], [1000, "platforms"], [3000, "manual"], [4000, "burden"]]);
  const brief = {
    script: "x", keywordFlags: [],
    scenes: [{ label: "a", spokenLine: "problem platforms", onScreenText: "PLATFORMS", brollCue: "logos rain in" }],
  } as RenderBrief;
  let calls = 0;
  const plan = await planEdit({
    brief,
    words: w,
    durationMs: 7000,
    assetHints: [],
    generate: async () => {
      calls++;
      return {
        creativeDirection: { emphasisColor: "#ffcc00" },
        beats: [{ anchorMs: 1000, durMs: 2000, mode: "overlay", intent: "one logo", priority: 90 }],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(plan.scenes.length, 1);
  assert.equal(plan.creativeDirection.emphasisColor, "#ffcc00");
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

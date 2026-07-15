# Premium Engine Productionization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated bespoke-scene spike into a production render path: the premium engine consumes the brief's own scene ideas + uploaded assets, authors real product-UI motion graphics (not headline cards), runs on a fast/tunable model tier, and renders scenes in parallel — cutting a 6-scene job from ~41 min to a few minutes.

**Architecture:** The premium path (`render/src/premium/*`) already storyboards → authors HyperFrames HTML → vision-QA loops → composites over the captioned base. Spike 2 proved that with (a) real assets, (b) visual-first author/QA prompts, and (c) a gpt-5.x model it produces scenes rivaling the hand-made SUTD gold. This plan makes those three changes permanent, adds a deterministic `brief.scenes → SceneSpec` path (so the author gets the human's actual visual ideas instead of a re-storyboard from the bare script), makes model/effort/concurrency env-tunable, and parallelizes scene production with the existing `createSemaphore`.

**Tech Stack:** TypeScript (ESM, NodeNext), `node:test` + `node:assert/strict` (run via `npm run test:unit` in `render/`), OpenAI chat/completions (gpt-5.x reasoning models), HyperFrames CLI + ffmpeg.

**Scope note (per writing-plans scope-check):** This plan covers **only the render engine** (Track A "productionize" + "speed/model tier"). The **assets-upload UI** (screenshots/logo/brand-color capture in the studio → persist into `brief.assets`) is a distinct subsystem (Next app: DB schema + storage + React) and gets its **own plan** — `docs/superpowers/plans/2026-07-15-assets-upload-ui.md` (to be written next). This engine plan is testable on its own: assets and `brief.scenes` are fed via the brief JSON (exactly as the render request already carries them), so the engine can be validated end-to-end before the UI exists.

**Branch:** `git checkout -b feat/premium-engine origin/main`. The improved author/QA prompt text lives only on the throwaway `spike/assets-engine` branch — this plan reproduces it inline (Task 2/Task 3), so the branch does **not** depend on the spike branch. Do NOT push to `main`; open a PR. No `Co-Authored-By: Claude` trailer.

---

## File Structure

- **Create** `render/src/premium/model-params.ts` — pure helpers deciding per-model request tuning (`reasoning_effort` for gpt-5.x/o-series; no `temperature`, which gpt-5.x rejects). One responsibility: model quirks in one place.
- **Modify** `render/src/premium/scenes.ts` — add `scenesFromBrief` / `findAnchorMs` / `buildSceneIntent`; make `planScenes` prefer the brief's own scenes; use `model-params`; default plan model → `gpt-5.4-mini`.
- **Modify** `render/src/premium/author.ts` — visual-first system prompt (ban headline-only cards, demand asset embedding); use `model-params`; default author model → `gpt-5.4`.
- **Modify** `render/src/premium/qa.ts` — visual-first QA prompt (reject text-only cards); use `model-params`; default QA model → `gpt-5.4-mini`.
- **Modify** `render/src/premium/index.ts` — parallelize `produceScene` via `createSemaphore(PREMIUM_CONCURRENCY)`; default `MAX_QA_ITERS` → 1.
- **Modify** `render/tests/premium.test.ts` — add tests for the new deterministic helpers.
- **Modify** `render/DECISIONS.md` — record the model/effort/concurrency defaults and the brief.scenes-first behavior.

All render commands run from `render/`.

---

## Task 1: Per-model request tuning (`model-params.ts`)

gpt-5.x + o-series reject a custom `temperature` and instead accept `reasoning_effort` (`low`/`medium`/`high` — **not** `minimal`). gpt-4o is the opposite. Centralize the decision so every OpenAI call in the premium path is consistent and env-tunable.

**Files:**
- Create: `render/src/premium/model-params.ts`
- Test: `render/tests/premium.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `render/tests/premium.test.ts`)

```ts
import { isReasoningModel, normalizeEffort, chatTuning } from "../src/premium/model-params.js";

test("isReasoningModel: gpt-5.x and o-series are reasoning models; gpt-4o is not", () => {
  for (const m of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "o3", "o4-mini"]) {
    assert.equal(isReasoningModel(m), true, `${m} should be a reasoning model`);
  }
  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1"]) {
    assert.equal(isReasoningModel(m), false, `${m} should NOT be a reasoning model`);
  }
});

test("normalizeEffort: accepts low/medium/high, defaults everything else to low", () => {
  assert.equal(normalizeEffort("medium"), "medium");
  assert.equal(normalizeEffort("HIGH"), "high");
  assert.equal(normalizeEffort("low"), "low");
  assert.equal(normalizeEffort("minimal"), "low"); // gpt-5.x rejects minimal -> fall back
  assert.equal(normalizeEffort(undefined), "low");
  assert.equal(normalizeEffort(""), "low");
});

test("chatTuning: reasoning models get reasoning_effort and NO temperature; legacy models get neither", () => {
  assert.deepEqual(chatTuning("gpt-5.4", "medium"), { reasoning_effort: "medium" });
  assert.deepEqual(chatTuning("gpt-5.4", undefined), { reasoning_effort: "low" });
  assert.deepEqual(chatTuning("gpt-4o", "medium"), {}); // no temperature key at all
  assert.equal("temperature" in chatTuning("gpt-5.4", "low"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../src/premium/model-params.js'`.

- [ ] **Step 3: Write the implementation**

Create `render/src/premium/model-params.ts`:

```ts
/**
 * Per-model request quirks in one place. gpt-5.x / o-series reject a custom `temperature`
 * and instead take `reasoning_effort` (low|medium|high — NOT minimal). gpt-4o is the reverse.
 * We drop `temperature` entirely (default is fine for both) and only add `reasoning_effort`
 * for models that accept it, so the same call site works across model tiers.
 */
export type ReasoningEffort = "low" | "medium" | "high";

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[0-9])/i.test(model.trim());
}

export function normalizeEffort(raw: string | undefined): ReasoningEffort {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "medium" || v === "high" ? v : "low";
}

/** Spread into `client.chat.completions.create({...})`. Empty object for legacy models. */
export function chatTuning(
  model: string,
  effort: string | undefined,
): { reasoning_effort?: ReasoningEffort } {
  return isReasoningModel(model) ? { reasoning_effort: normalizeEffort(effort) } : {};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (all three new tests green; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add render/src/premium/model-params.ts render/tests/premium.test.ts
git commit -m "feat(premium): centralize per-model request tuning (reasoning_effort, no temperature)"
```

---

## Task 2: Visual-first author + QA prompts on the fast model tier

Bring the spike's proven prompt flips into the tree and route the model + effort through env + `chatTuning`. The old author prompt literally ordered "a SHORT punchy headline… 2-5 words" and the old QA prompt *failed* scenes with "text longer than a headline" — those two rules manufactured the slop. Flip both, and drop the hardcoded `temperature`.

**Files:**
- Modify: `render/src/premium/author.ts`
- Modify: `render/src/premium/qa.ts`

- [ ] **Step 1: Rewrite the author system prompt + call params** in `render/src/premium/author.ts`

Change the model default and imports at the top:

```ts
import { getOpenAI } from "../openai.js";
import { chatTuning } from "./model-params.js";
import type { RenderBrief, SceneSpec } from "../types.js";

const AUTHOR_MODEL = process.env.PREMIUM_AUTHOR_MODEL || "gpt-5.4";
const AUTHOR_EFFORT = process.env.PREMIUM_AUTHOR_EFFORT; // default "low" via chatTuning
```

Replace rule **8** in `systemPrompt` (the "YOU ARE NOT A SUBTITLE TRACK … SHORT punchy headline … 2-5 words" block) with rules 8–10:

```
8. BUILD A VISUAL, NOT A CAPTION. A bare headline/label on a background — a text card — is the #1
   failure mode and will be REJECTED. Every scene must SHOW something concrete: the product screenshot,
   the logos, a recreated UI element, a chart/number that animates, a diagram. Text is a label ON the
   visual, never the whole scene. You are NOT a subtitle track — the spoken words are already captioned
   along the bottom, so never transcribe speech or reproduce the spoken sentence.
9. FEATURE THE ASSETS. When assets are provided (see "assets"), the scene MUST be built AROUND them:
   embed the actual image with <img src="./assets/<filename>" style="..."> (a screenshot in a device/
   browser frame, logos as real tiles, a UI cropped and called out). Do NOT describe an asset in text
   when you can show it. Only fall back to a pure-CSS visual when NO asset fits the beat.
10. Follow "intent" literally — it names the exact visual to build and which asset(s) to feature. The
    short on-screen headline (if any) comes from the intent; everything else is motion + imagery.
```

Replace the OpenAI call (remove `temperature`, spread `chatTuning`):

```ts
  const resp = await client.chat.completions.create({
    model: AUTHOR_MODEL,
    ...chatTuning(AUTHOR_MODEL, AUTHOR_EFFORT),
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: priorIssues?.length
          ? `Re-author this scene, FIXING these issues found by visual review:\n${JSON.stringify(payload)}`
          : `Author this scene:\n${JSON.stringify(payload)}`,
      },
    ],
  });
```

- [ ] **Step 2: Rewrite the QA system prompt + call params** in `render/src/premium/qa.ts`

Top of file:

```ts
import { chatTuning } from "./model-params.js";
const QA_MODEL = process.env.PREMIUM_QA_MODEL || "gpt-5.4-mini";
const QA_EFFORT = process.env.PREMIUM_QA_EFFORT; // default "low"
```

Replace `QA_SYSTEM` with the visual-first reviewer:

```ts
const QA_SYSTEM = `You are a ruthless art director reviewing frames of a bespoke motion-graphic scene
composited over talking-head footage in a vertical (1080x1920) marketing video. The footage ALREADY has
burned-in captions along the bottom. Judge ONLY what you can see. FAIL the scene for:
- IT'S JUST TEXT. A headline/label on a background with no real visual is the #1 failure. A scene must
  SHOW something concrete — the product screenshot, the logos, a UI element, a chart — not merely words.
- reproducing the spoken sentence as on-screen subtitles / duplicating the bottom captions
- misspelled or garbled on-screen text
- text/graphics clipped at an edge, overlapping badly, or unreadable (too small / low contrast)
- graphics covering the bottom caption band or burying the speaker's face in the center third
- empty/broken render (nothing meaningful on screen) or obvious AI-slop layout
Respond with JSON: { "ok": boolean, "issues": string[] }. Each issue is a SHORT concrete fix
("embed the actual screenshot, don't just name it", "move the title out of the center",
"fix 'Triger.dev' -> 'Trigger.dev'"). Return an empty issues array when the scene is good.`;
```

Replace the OpenAI call (remove `temperature: 0`, spread `chatTuning`):

```ts
  const resp = await client.chat.completions.create({
    model: QA_MODEL,
    ...chatTuning(QA_MODEL, QA_EFFORT),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: QA_SYSTEM },
      { role: "user", content: [ { type: "text", text: `Scene intent: ${spec.intent}\nThe footage already shows these spoken words as bottom captions (the scene must NOT repeat them as subtitles): ${spec.captionText}\nReview the ${frames.length} frames.` }, ...images ] },
    ],
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors from `author.ts` / `qa.ts` (pre-existing unrelated errors, if any, ignored).

- [ ] **Step 4: Run unit tests (nothing should regress)**

Run: `npm run test:unit`
Expected: PASS. (`parseQaVerdict` + `produceScene` tests use injected deps / stubbed content, so the prompt change doesn't affect them.)

- [ ] **Step 5: Commit**

```bash
git add render/src/premium/author.ts render/src/premium/qa.ts
git commit -m "feat(premium): visual-first author/QA prompts on gpt-5.4 tier (ban headline-only cards)"
```

---

## Task 3: Deterministic `brief.scenes → SceneSpec` builder

Today `planScenes` throws away `brief.scenes` and re-storyboards from the bare `brief.script`, so the human's actual visual ideas (`brollCue`: "logos slam", "chips split", "Telegram chat") and headlines (`onScreenText`) never reach the author. When the brief already carries scenes, build specs directly from them — anchoring each to where its `spokenLine` occurs in the word timeline — instead of paying for and trusting an LLM re-storyboard.

**Files:**
- Modify: `render/src/premium/scenes.ts`
- Test: `render/tests/premium.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `render/tests/premium.test.ts`)

```ts
import { findAnchorMs, buildSceneIntent, scenesFromBrief } from "../src/premium/scenes.js";
import type { RenderBrief, Word } from "../src/types.js";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `findAnchorMs`/`buildSceneIntent`/`scenesFromBrief` are not exported.

- [ ] **Step 3: Implement in `render/src/premium/scenes.ts`**

Add imports + a shared default motif constant near the top (extract the existing inline default so both paths share it):

```ts
import type { RenderBrief, Word, SceneSpec, RenderBriefScene } from "../types.js";
import { chatTuning } from "./model-params.js";

const PLAN_MODEL = process.env.PREMIUM_PLAN_MODEL || "gpt-5.4-mini";
const PLAN_EFFORT = process.env.PREMIUM_PLAN_EFFORT; // default "low"
const DEFAULT_MOTIF = "a single accent-colored shape (e.g. a chip/bar) that transforms across scenes";
```

Add the helpers (place above `planScenes`):

```ts
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string): string[] => norm(s).split(" ").filter(Boolean);

/**
 * Find where a brief scene's spokenLine occurs on the word timeline. Matches the line's first few
 * tokens as a run; falls back to the first single-token hit; returns null if nothing matches (the
 * caller then places the scene sequentially).
 */
export function findAnchorMs(spokenLine: string, words: Word[]): number | null {
  const target = tokens(spokenLine).slice(0, 4);
  if (target.length === 0 || words.length === 0) return null;
  const wt = words.map((w) => norm(w.text));
  for (let i = 0; i + target.length <= wt.length; i++) {
    if (target.every((t, k) => wt[i + k] === t)) return Math.round(words[i].startMs);
  }
  const j = wt.indexOf(target[0]);
  return j >= 0 ? Math.round(words[j].startMs) : null;
}

/** Turn one brief scene into a rich author directive: the visual idea + headline + which asset to feature. */
export function buildSceneIntent(scene: RenderBriefScene, assetHints: string[]): string {
  const cue = (scene.brollCue || "").trim() || (scene.label || "").trim() || "a bespoke visual for this beat";
  const headline = (scene.onScreenText || "").trim()
    ? ` The short on-screen headline is "${scene.onScreenText.trim()}" — everything else must be a real visual, not more text.`
    : "";
  const asset = assetHints.length
    ? ` Feature the provided asset(s) by embedding the real image: ${assetHints.join(", ")}.`
    : "";
  return `${cue}.${headline}${asset} Build a bespoke motion graphic around this beat — a headline-only card is NOT acceptable.`;
}

/**
 * Build SceneSpecs straight from the brief's own scenes (the human's visual ideas), anchoring each
 * to where its spokenLine lands on the word timeline. Reuses normalizeScenes for snap/clamp/de-overlap.
 */
export function scenesFromBrief(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
}): SceneSpec[] {
  const { brief, words, durationMs, assetHints } = args;
  const scenes = brief.scenes ?? [];
  const motif = brief.assets?.motif?.trim() || DEFAULT_MOTIF;
  const wordStarts = words.map((w) => Math.round(w.startMs));
  const span = Math.max(1500, Math.floor(durationMs / Math.max(1, scenes.length)));

  let cursor = 0;
  const raw = scenes.map((s) => {
    const anchor = findAnchorMs(s.spokenLine || "", words) ?? cursor;
    const durMs = s.durationSeconds ? Math.round(s.durationSeconds * 1000) : span;
    cursor = anchor + durMs;
    return { anchorMs: anchor, durMs, intent: buildSceneIntent(s, assetHints), captionText: (s.spokenLine || "").trim() };
  });

  return normalizeScenes(raw, wordStarts, motif, durationMs);
}
```

Update the existing LLM-storyboard call inside `planScenes` to drop `temperature` and use the tier (leave the rest of that function intact for the no-brief-scenes fallback):

```ts
  const resp = await client.chat.completions.create({
    model: PLAN_MODEL,
    ...chatTuning(PLAN_MODEL, PLAN_EFFORT),
    response_format: { type: "json_object" },
    messages: [ { role: "system", content: SYSTEM }, { role: "user", content: user } ],
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (new helper tests green; existing `normalizeScenes` test unaffected).

- [ ] **Step 5: Commit**

```bash
git add render/src/premium/scenes.ts render/tests/premium.test.ts
git commit -m "feat(premium): build scenes from brief.scenes (anchor spokenLine, feed brollCue+assets to author)"
```

---

## Task 4: Prefer the brief's scenes in `planScenes`

**Files:**
- Modify: `render/src/premium/scenes.ts`
- Test: `render/tests/premium.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append)

```ts
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
```

(Ensure `planScenes` is imported in the test file — add it to the existing `../src/premium/scenes.js` import if not already there.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — current `planScenes` ignores `brief.scenes` and calls OpenAI (throws "missing OPENAI_API_KEY" or hangs).

- [ ] **Step 3: Implement the dispatch** — at the very top of `planScenes` body, before the OpenAI storyboard:

```ts
export async function planScenes(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
}): Promise<SceneSpec[]> {
  const { brief, words, durationMs, assetHints } = args;
  if (words.length === 0) return [];

  // Prefer the brief's own scenes (the human's visual ideas) — deterministic, no LLM re-storyboard.
  if ((brief.scenes?.length ?? 0) > 0) {
    const fromBrief = scenesFromBrief({ brief, words, durationMs, assetHints });
    if (fromBrief.length > 0) return fromBrief;
    // else fall through to the LLM storyboard (e.g. none of the spokenLines could be anchored)
  }
  // ... existing LLM-storyboard body unchanged ...
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add render/src/premium/scenes.ts render/tests/premium.test.ts
git commit -m "feat(premium): planScenes prefers brief.scenes over an LLM re-storyboard"
```

---

## Task 5: Parallelize scene production + faster QA default

Scenes are authored/rendered/QA'd sequentially "to bound Chromium memory" — that's the ~41 min killer. Cap concurrency with the existing `createSemaphore` (proven: 2 concurrent heavy renders are safe on the Railway box, 3 OOMs) and default the QA retry budget to 1.

**Files:**
- Modify: `render/src/premium/index.ts`

- [ ] **Step 1: Change the QA-iteration default from 2 to 1**

```ts
const MAX_QA_ITERS =
  Number.isFinite(MAX_QA_ITERS_RAW) && MAX_QA_ITERS_RAW > 0 ? MAX_QA_ITERS_RAW : 1;
```

- [ ] **Step 2: Add the concurrency import + env cap** (top of `index.ts`, near the other env consts)

```ts
import { createSemaphore } from "../semaphore.js";

// Parallel scene production. Each scene is a HyperFrames Chromium render + ffmpeg composite, which
// is as heavy as a full render, so keep this low: 2 is the proven-safe ceiling on the live box
// (see semaphore.ts / DECISIONS.md 2026-07-10; 3 concurrent heavy renders OOM). Tunable, clamped 1..4.
const PREMIUM_CONCURRENCY_RAW = Number(process.env.PREMIUM_CONCURRENCY);
const PREMIUM_CONCURRENCY = Number.isFinite(PREMIUM_CONCURRENCY_RAW)
  ? Math.min(4, Math.max(1, Math.floor(PREMIUM_CONCURRENCY_RAW)))
  : 2;
```

- [ ] **Step 3: Replace the sequential author loop in `runPremium`** (the `for (const spec of specs) { ... }` block, step 3) with a semaphore-bounded parallel map that preserves order:

```ts
  // 3. Author -> render -> QA each scene, up to PREMIUM_CONCURRENCY at a time (order preserved).
  const sem = createSemaphore(PREMIUM_CONCURRENCY);
  const authored: AuthoredScene[] = await Promise.all(
    specs.map((spec) =>
      sem.run(async () => {
        try {
          return await produceScene({ spec, brief, assetHints, assetsDir, premiumDir, basePath, fps, log });
        } catch (e) {
          log(`premium: scene ${spec.id} failed, skipping — ${(e as Error).message}`);
          return { spec, html: "" } as AuthoredScene; // no movPath -> skipped in compose
        }
      }),
    ),
  );
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `npm run check && npm run test:unit`
Expected: PASS. (`produceScene` is unchanged; the existing produceScene test still passes. `Promise.all` preserves array order so `composeScenes` still gets scenes in timeline order.)

- [ ] **Step 5: Commit**

```bash
git add render/src/premium/index.ts
git commit -m "perf(premium): render scenes in parallel (semaphore, cap 2) + default QA retries to 1"
```

---

## Task 6: End-to-end integration checkpoint (manual, gated on a key)

Unit tests can't judge scene *quality* — that's what the vision-QA loop and your eyes are for. Validate the whole path on the real SUTD brief with scenes + assets, on the fast tier.

**Files:**
- Use: the existing `render/scripts/test-local.ts` harness (or `scripts/spike2.ts` on the spike branch as a reference). Do NOT commit new throwaway harnesses.

- [ ] **Step 1: Prepare a brief with `scenes` + `assets.images`** pointing at the real SUTD screenshots (public URLs, or local paths staged into the workdir — the same set the spike used: `main-view.png`, `course-filter.png`, `calendar-export.png`, logos). Set `editMode: "generated-experimental"`.

- [ ] **Step 2: Run the real pipeline on the fast tier**

Run (from `render/`):
```bash
PREMIUM_AUTHOR_MODEL=gpt-5.4 PREMIUM_QA_MODEL=gpt-5.4-mini PREMIUM_PLAN_MODEL=gpt-5.4-mini \
PREMIUM_AUTHOR_EFFORT=low PREMIUM_CONCURRENCY=2 \
npm run test:local
```
Expected: `planScenes` logs "N scenes planned" (from the brief's scenes, not a re-storyboard), scenes author/render/QA in parallel, most approved, an output mp4 written.

- [ ] **Step 3: Watch the clip end-to-end.** Confirm: (a) scenes feature the real screenshots/logos, not headline cards; (b) motion reads as designed (motif carries); (c) nothing covers the face / caption band; (d) wall-clock is minutes, not ~40. Record the timing + a one-line verdict.

- [ ] **Step 4: Log the result** in `render/DECISIONS.md` (model/effort/concurrency defaults, measured wall-clock, quality verdict) and tick the roadmap. Commit:

```bash
git add render/DECISIONS.md docs/video-animation-roadmap.md
git commit -m "docs(premium): record productionized engine defaults + e2e timing/quality"
```

- [ ] **Step 5: Open the PR** (base `main`), summarizing: brief.scenes-first storyboarding, visual-first prompts, gpt-5.4 tier + tunable effort, parallel rendering. Note the model env vars for Railway. **No AI-attribution footer.**

---

## Self-Review

- **Spec coverage:** Task 3+4 = "wire planScenes to consume brief.scenes + assets" ✓. Task 2 = "keep the new author/QA prompts" ✓. Task 1+2+5 = "speed/model tier: faster model, parallel renders, fewer retries, tunable env" ✓. Assets-upload UI = explicitly out of scope → separate plan (flagged) ✓.
- **Placeholders:** none — every code step shows the actual code; every test step shows real assertions.
- **Type consistency:** `chatTuning(model, effort)` signature identical across Tasks 1/2/3. `scenesFromBrief`/`findAnchorMs`/`buildSceneIntent` names match between definition (Task 3) and tests (Task 3) and caller (Task 4). `AuthoredScene`/`SceneSpec`/`RenderBriefScene`/`Word` are the real exported types from `render/src/types.ts`.
- **Env vars introduced:** `PREMIUM_AUTHOR_MODEL` (gpt-5.4), `PREMIUM_QA_MODEL`/`PREMIUM_PLAN_MODEL` (gpt-5.4-mini), `PREMIUM_{AUTHOR,QA,PLAN}_EFFORT` (low), `PREMIUM_CONCURRENCY` (2), `PREMIUM_MAX_QA_ITERS` (1). All have safe defaults; none required.

## Dependency / interaction note
- Parallel scene renders run *inside* one render-service job slot. If `RENDER_CONCURRENCY > 1` (whole-job concurrency) is ever combined with `PREMIUM_CONCURRENCY = 2`, worst case is `RENDER_CONCURRENCY × 2` heavy renders — watch memory on the box and lower `PREMIUM_CONCURRENCY` to 1 if premium jobs ever overlap. Documented in the commit + DECISIONS.md.
- Premium stays behind the existing `editMode === "generated-experimental"` gate + render-credit tier; nothing in this plan changes the default `brief-driven` behavior.

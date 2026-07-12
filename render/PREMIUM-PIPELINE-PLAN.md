# Premium render pipeline — implementation plan (agent scene-gen + visual QA)

Closes the animation gap proof's fixed-component render can't (the SUTD Deadline Center benchmark
proved the approach manually). Ships behind a `premium` credit-toggle so the default stays fast/cheap.

## Decisions (locked)
- **Model:** GPT (OpenAI — we have credits; no Claude credits). Scene HTML + the vision-QA both on GPT-4o.
- **Renderer:** HyperFrames for the bespoke path (plain HTML/GSAP → GPT authors it reliably, alpha MOV
  composites into the existing ffmpeg step). Keep Remotion for the fixed-component default.
- **Gating:** a `premium: true` flag on the render request → charges more credits; default = today's pipeline.

## Where it plugs in (`render/src/job.ts`, between remap ~L125 and the Remotion render ~L149)
Today: remap → build props → `renderOverlay` (fixed components) → `compositeOverlay`.
Premium branch: remap → **generate bespoke scenes → render each → visual-QA loop → composite**.

## New modules
1. `render/src/premium/scenes.ts`
   - `planScenes(brief, captionWords, assets, durationMs)`: one GPT call → an array of scene specs
     `{ id, anchorMs, durMs, motif, prompt }`, one per beat, anchored to real word timings, sharing a
     recurring motif. (This is the "storyboard" step.)
2. `render/src/premium/author.ts`
   - `authorScene(spec, assets, tokensCss)`: GPT call → a full HyperFrames composition (HTML+GSAP,
     transparent 1080×1920) for that scene. Enforce the composition contract (root data-*, class="clip",
     paused timeline on `window.__timelines`). Retry on lint failure (`hyperframes check`).
3. `render/src/premium/qa.ts`
   - `qaScene(movPath, anchorMs, durMs, basePath)`: composite the scene over the base, extract ~4 frames,
     one GPT-4o **vision** call per scene → `{ ok, issues[] }`. If not ok, feed issues back to `authorScene`
     and re-render (max ~2 iterations). This is the loop that killed the slop.
4. `render/src/premium/compose.ts`
   - Composite all scene MOVs at their anchors + captions (ASS) onto the base — port `assemble.sh` from
     the SUTD run into ffmpeg-node calls; add the face-PiP overlay for full-frame cutaway scenes.

## Assets folder (greenlit — "like Claude design: upload a folder, extract brand")
- Extend `RenderBrief` with `assets?: { images?: string[]; brandColor?: string; brandVoice?: string }`.
- Next app: an upload step that takes a folder (screenshots, logos) + optionally reads a connected repo's
  brand (colors from CSS/tailwind, tone from README) — the "connect repo → extract brand/UI" idea.
- The render service fetches the asset URLs into the workdir and passes their local paths to `planScenes`
  / `authorScene` so scenes can embed real UI/screenshots (the SUTD payoff *needed* this).

## Concurrency / cost / safety
- Premium renders are minutes + many GPT calls. Run scene authoring + QA with a small internal pool
  (respect the existing `RENDER_CONCURRENCY` semaphore for the heavy HyperFrames renders).
- Hard timeout + graceful fallback: if premium generation fails or times out, fall back to the
  fixed-component render so the user still gets a video (and refund the premium delta).
- Add HyperFrames as a `render/` dependency; the service already has headless Chrome for the QA frames.

## Rollout
1. **Now (this PR):** script-as-prompt whisper (done) — better captions on every render.
2. **Phase 1:** assets folder plumbing (`RenderBrief.assets`) + Next upload UI.
3. **Phase 2:** `premium/` modules + the `premium` flag, tested live against the deployed Railway render
   service on a real take, benchmarked against the fixed-component output on the same take.

## Verification
Phase 2 must be tested end-to-end on the render service (not just unit tests): POST a `premium` render
with a real take + assets, poll to done, and eyeball the output vs the SUTD manual benchmark
(`SUTD Deadline Centre demo/sutd-final-v2.mp4`) and vs the fixed-component render on the same take.

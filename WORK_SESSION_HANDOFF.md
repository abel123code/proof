# Proof Render Pipeline Handoff

This file summarizes the render-pipeline investigation and implementation so work can resume safely in the next session.

## Resume First

1. Review both layers of the working tree before changing anything:

   ```powershell
   git status --short
   git diff --cached
   git diff
   ```

   Many files show `MM` or `AM`: an earlier version is staged, while later refinements are still unstaged. Do not use `git reset --hard` or overwrite the staged baseline.

2. Restart the render worker. It runs with `tsx`, not watch mode, so source changes do not hot reload:

   ```powershell
   # From the repository root
   npm --prefix render run server

   # Or, from the render directory
   npm run server
   ```

3. Confirm the boot line reports generated/premium mode and that the premium engine is available.
4. Run one new render and wait for `DONE <video-id>` before treating it as complete.

## Architecture Clarified

- FFmpeg owns source-footage cutting and final composition.
- Remotion still produces the base edit and captions. Its Chromium download is expected and does not mean HyperFrames is unused.
- HyperFrames produces bespoke premium scene overlays.
- Captions composite after creator visuals.
- A full-frame scene may receive a solid black background; a footage-backed overlay remains transparent over the speaker.

## Completion and Queue Work

- The UI previously appeared complete while rendering was still running. Durable job state is now the source of truth for polling.
- Final completion is recorded only after the stitched output is ready and durable state is updated.
- The worker logs `DONE <video-id>` only after durable completion succeeds (`render/src/completion.ts`).
- A worker restart can leave a processing lease alive for 15 minutes. One accidentally queued job was cancelled manually:
  - Job: `967d7480-b17f-454e-a9c9-5377aaeca119`
  - Brief: `c78781ca-9cd0-4c7a-a331-393c5d574f8f`
- The live `render_jobs` table was queried successfully. No new database migration was created for the visual changes in this session.

## Creator-Native Visual Pipeline

The pipeline now uses a global edit plan with three intentional visual states:

1. Clean talking-head footage.
2. One supporting footage-backed overlay.
3. A full-frame explanation, optionally on solid black.

Current rules:

- One visual authority per beat; replace elements instead of stacking dashboards and cards.
- At least 25% clean A-roll, no more than 35% overlay coverage, and no more than 40% full-frame coverage.
- Full-frame black takeovers are selected only when the visual needs to own the frame or would substantially cover the face.
- Black takeovers remain unchanged because their current style is working.
- QA creates a `SceneReport` for every scene. Objective safety issues retry up to the budget, then ship flagged; subjective polish notes do not trigger automatic rewrites.

## Cut-Off Text Root Cause and Fix

Diagnosed output:

- `render/out/edited-c72cef5f-6fe4-4766-b275-403eee61c450.mp4`

The HyperFrames title was correct, but the deterministic FFmpeg face mask started at `y=420` while the title crossed that boundary. FFmpeg erased the lower half of the letters.

Pipeline fix:

- The protected face-feature corridor now starts at `y=560` in `render/src/ffmpeg.ts`.
- The overhead title rail remains fully visible through `y=520`.
- Pixel-level regression tests ensure `(500,450)` stays opaque while the face-feature corridor remains transparent.
- QA had detected the clipping in the original run, but the HTML author could not repair a compositor-owned mask. The system-level mask was therefore the correct fix.

A local scene-only verification artifact exists under:

```text
tmp/cutoff-analysis/c72cef5f-6fe4-4766-b275-403eee61c450/
```

It was used only to confirm the pipeline fix and was not uploaded or substituted for a user render.

## Large Top-Centered Text Guidance

The latest requested visual refinement was implemented as prompt guidance, not a hardcoded HTML template:

- Text-only footage overlays default to one large top-centered editorial headline.
- Typography target: bold system sans, `76-96px`, maximum two lines.
- Use one emphasis color.
- Avoid pills, cards, badges, opaque backplates, typewriter animation, character-by-character animation, repeated pulses, and decorative scale loops.
- Prefer a restrained fade with a short vertical settle, or replace one complete phrase with another.
- Side placement remains valid for an essential icon, asset, or diagram using genuine negative space.
- QA records a small or weak text-only overlay as a subjective polish note rather than an objective safety failure.

Relevant locations:

- Planner guidance: `render/src/premium/scenes.ts`
- HyperFrames author contract: `render/src/premium/author.ts`
- Vision QA rubric: `render/src/premium/qa.ts`
- Regression tests: `render/tests/premium.test.ts`
- Decision record: `DECISIONS.md`

## Outputs

Newest observed output at the end of the session:

```text
render/out/edited-8f6231da-a818-484d-b19f-a07399916767.mp4
```

This newest file was discovered after the final code changes but was not frame-by-frame reviewed during the handoff-writing step. Start the next visual review with this file.

Other useful outputs:

- `edited-b236cac2-5664-4eee-ba8e-62a3439431ff.mp4`
- `edited-c72cef5f-6fe4-4766-b275-403eee61c450.mp4` - confirmed mask-clipping example.
- `edited-269faaef-f2b4-429d-8cd3-e005e4c33f80.mp4` - earlier creator-native version.

## Validation Completed

Latest completed checks:

```powershell
npm --prefix render run check
npm --prefix render run test:unit
npm run verify
npm run lint
npm run build
```

Results:

- Render TypeScript check passed.
- Render unit tests: 104 passed.
- Root tests: 61 passed across 14 files.
- Production build passed.
- Lint has zero errors and six pre-existing warnings in the studio/teleprompter components.

## Working-Tree Warning

The repository currently contains a mixture of staged and unstaged work. In particular:

- `MM` files contain both the earlier staged version and newer unstaged refinements.
- `AM` tests were added to the index and then modified again.
- `tmp/reference-analysis/IMG_9014/` analysis images and notes are staged.
- `tmp/cutoff-analysis/` is untracked.
- This handoff file is intentionally untracked until reviewed.

Before committing, decide whether the generated analysis assets belong in Git. Do not stage credentials, `.env` files, local source videos, or generated final videos.

## Suggested Next Session

1. Restart the worker and confirm premium mode at boot.
2. Review `edited-8f6231da-a818-484d-b19f-a07399916767.mp4` frame-by-frame.
3. Check that text-only footage overlays are large, centered, fully visible, and visually restrained.
4. Confirm black full-frame takeovers still look unchanged.
5. Confirm the terminal prints `DONE <video-id>` only after the final stitched MP4 exists.
6. Review `git diff --cached` versus `git diff`, then intentionally stage only the final desired version.

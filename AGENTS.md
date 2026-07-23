# Proof agent guide

Proof turns a GitHub repository and a founder recording into a researched, scripted, cut,
animated, vision-reviewed vertical video.

## Read first

1. `README.md` for the product and system map.
2. `OPENAI_BUILD_WEEK.md` for the Sol, Luna, Whisper, and Codex evidence.
3. `DECISIONS.md` for measured capacity and render-mode decisions.
4. `render/README.md` for the worker contract.
5. `ROADMAP.md` for the next quality bar.

## Commands

```bash
npm ci
npm run verify
npm run lint
npm run build

npm --prefix render ci
npm --prefix render run check
npm --prefix render run test:unit
```

`npm run verify:openai` is an opt-in live API smoke test. It requires `OPENAI_API_KEY` and incurs
API usage.

## Invariants

- GPT-5.6 Luna owns structured, high-volume work. GPT-5.6 Sol owns research, ranking, scene
  design, and rendered-frame judgment. Whisper owns word timing.
- TypeScript owns control flow and final score calculation. Models do not self-award final ranks.
- FFmpeg owns source footage. Remotion and HyperFrames produce overlays.
- Model-authored HTML is untrusted and must pass validation before Chromium renders it.
- The normal generated path cannot bypass five-frame vision QA.
- Scenes are never silently omitted. QA is an auditable advisor: objective SAFETY faults (graphic on
  a face feature / in the caption band, garbled or clipped text, missing required asset) are auto-repaired
  up to the retry budget, then the scene SHIPS FLAGGED; SUBJECTIVE notes (creative/copy/polish) never
  block and never drive a re-author. Every scene carries a `SceneReport` (verdict + reasons + tags) so the
  app can show the user why and ask whether to re-render. The captioned base is the per-scene fallback
  (verdict `base_fallback`) only when a scene cannot be rendered safely at all.
- The web route and render worker own `RENDER_EDIT_MODE`; callers cannot select a weaker mode.
- Never commit credentials, local media paths, generated videos, or `.env` files.

## Definition of done

- Add a regression test before changing behaviour.
- Run the narrow test first, then the complete package checks above.
- For UI changes, inspect desktop and mobile renders.
- For render changes, inspect actual output frames or video, not only generated HTML.
- For deployed changes, verify the live route and provider logs.

## Next.js rule

This repository uses Next.js 16. APIs and conventions may differ from older training data. Read
the relevant guide in `node_modules/next/dist/docs/` before changing framework behaviour and
heed deprecation notices.

import type { SceneReport } from "../types.js";

/**
 * The audit record for when the WHOLE premium tier fell back to the captioned base — i.e. `runPremium`
 * threw (HyperFrames CLI missing, Chromium download failed, `planScenes` produced nothing, OpenAI
 * error, …) and `job.ts` shipped the caption-only "base" video instead of bespoke scenes.
 *
 * Without this the fallback was INVISIBLE: the job still finished `render_status: "done"` with the old
 * caption-only output and no reason recorded — the exact "why is my video the old one?" confusion Abel
 * hit. A silent whole-tier drop is the single biggest hole in the "never drop a scene silently, always
 * surface why" model (DECISIONS.md 2026-07-23), so it gets a real report like any rejected scene: it is
 * persisted to `briefs.scene_reports` and the studio can show WHY zero bespoke scenes shipped.
 */
export function premiumFallbackReport(reason: string): SceneReport {
  return {
    sceneId: "premium-tier",
    anchorMs: 0,
    durMs: 0,
    intent: "Bespoke motion-graphics pass for the whole video.",
    verdict: "base_fallback",
    shipped: false,
    issues: [
      {
        kind: "safety",
        text:
          "Bespoke scenes did NOT render — shipped the captioned base instead of the premium video. " +
          `Reason: ${reason}`,
      },
    ],
    attempts: 0,
  };
}

/**
 * Boot-time coherence check. If the worker is configured for the bespoke-scene tier
 * (`generated-experimental`) but the HyperFrames engine isn't even resolvable, then EVERY render will
 * silently fall back to the captioned base — no bespoke scenes, ever. Surface that loudly at startup
 * (the way the RENDER_TOKEN check does) instead of leaving each render to discover it. Returns the
 * warning text, or `null` when the configuration is coherent.
 *
 * Note: this catches "engine not installed". It does NOT catch a missing Chromium (HyperFrames
 * downloads that on the first render), which still surfaces via {@link premiumFallbackReport} + the
 * loud per-render log — the two together cover the fallback causes.
 */
export function premiumEngineWarning(editMode: string, engineAvailable: boolean): string | null {
  if (editMode !== "generated-experimental") return null;
  if (engineAvailable) return null;
  return (
    "[premium] WORKER_EDIT_MODE=generated-experimental but the HyperFrames CLI is NOT installed " +
    "(the `hyperframes` package is missing from render/node_modules). EVERY render will fall back to " +
    "the captioned base — no bespoke scenes will ever ship. Fix: run `npm --prefix render ci`, then " +
    "confirm Chromium downloads on the first render."
  );
}

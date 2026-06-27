import type { BriefScene } from "@/lib/types";

/**
 * The brief shape the Zo render service consumes (see render/src/types.ts on the
 * feat/zo-remotion-render branch). Kept local to avoid coupling to that package.
 */
export interface RenderBrief {
  /** Full script the user read; load-bearing for the service's script-guided cut. */
  script: string;
  /** Phrases that get an on-screen emphasis overlay when spoken. */
  keywordFlags: { phrase: string; emphasis?: string }[];
  /** Larger overlays (text cards / images / diagrams) anchored by keyword or ratio. */
  overlays?: {
    type: "text-card" | "image" | "architecture-diagram";
    content: string;
    anchor: { kind: "keyword"; keyword: string } | { kind: "ratio"; at: number };
    durationMs?: number;
  }[];
  accentColor?: string;
}

const FALLBACK_SCENE_SECONDS = 5;

/**
 * Map our scene-by-scene brief to the render service's RenderBrief.
 *
 * IMPORTANT: pass ONLY the scenes that actually have footage, in the same order the
 * clips are concatenated on the render side, so `script` + overlay anchors line up
 * with the combined video timeline.
 */
export function toRenderBrief(scenes: BriefScene[]): RenderBrief {
  const script = scenes
    .map((s) => s.spokenLine?.trim())
    .filter(Boolean)
    .join("\n");

  const totalSeconds =
    scenes.reduce((acc, s) => acc + (s.durationSeconds || FALLBACK_SCENE_SECONDS), 0) ||
    FALLBACK_SCENE_SECONDS;

  // On-screen text becomes a text-card overlay anchored at the midpoint of its scene,
  // expressed as a ratio through the concatenated video.
  const overlays: RenderBrief["overlays"] = [];
  let elapsed = 0;
  for (const s of scenes) {
    const dur = s.durationSeconds || FALLBACK_SCENE_SECONDS;
    const text = s.onScreenText?.trim();
    if (text) {
      const midpoint = (elapsed + dur / 2) / totalSeconds;
      overlays.push({
        type: "text-card",
        content: text,
        anchor: { kind: "ratio", at: Math.min(0.99, Math.max(0, midpoint)) },
        durationMs: 2500,
      });
    }
    elapsed += dur;
  }

  return {
    script,
    keywordFlags: [],
    overlays,
  };
}

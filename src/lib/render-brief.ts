import type { BriefScene, RenderAssets } from "@/lib/types";

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
  /** Full creative context used by the brief-driven editor. */
  hook?: string;
  targetFeeling?: string;
  scenes: RenderBriefScene[];
  /** Per-brief assets folder (screenshots/logo/brand color) for the premium bespoke-scene path. */
  assets?: RenderAssets;
}

export interface RenderBriefScene {
  label: string;
  spokenLine: string;
  onScreenText: string;
  brollCue: string;
  durationSeconds?: number;
}

const FALLBACK_SCENE_SECONDS = 5;

/**
 * Drop empty/blank asset fields; return undefined when nothing meaningful is set, so the render
 * brief carries an `assets` block only when the user actually provided screenshots/logo/brand.
 */
export function normalizeAssets(assets?: RenderAssets): RenderAssets | undefined {
  if (!assets) return undefined;
  const images = (assets.images ?? []).map((s) => s.trim()).filter(Boolean);
  const brandColor = assets.brandColor?.trim() || undefined;
  const brandVoice = assets.brandVoice?.trim() || undefined;
  const motif = assets.motif?.trim() || undefined;
  if (images.length === 0 && !brandColor && !brandVoice && !motif) return undefined;
  return {
    ...(images.length ? { images } : {}),
    ...(brandColor ? { brandColor } : {}),
    ...(brandVoice ? { brandVoice } : {}),
    ...(motif ? { motif } : {}),
  };
}

/**
 * Map our scene-by-scene brief to the render service's RenderBrief.
 *
 * IMPORTANT: pass ONLY the scenes that actually have footage, in the same order the
 * clips are concatenated on the render side, so `script` + overlay anchors line up
 * with the combined video timeline.
 */
export function toRenderBrief(
  scenes: BriefScene[],
  context: { hook?: string; targetFeeling?: string; assets?: RenderAssets } = {},
): RenderBrief {
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

  const assets = normalizeAssets(context.assets);

  return {
    script,
    keywordFlags: [],
    overlays,
    hook: context.hook,
    targetFeeling: context.targetFeeling,
    scenes: scenes.map((scene) => ({
      label: scene.label,
      spokenLine: scene.spokenLine,
      onScreenText: scene.onScreenText,
      brollCue: scene.brollCue,
      durationSeconds: scene.durationSeconds,
    })),
    ...(assets ? { assets } : {}),
  };
}

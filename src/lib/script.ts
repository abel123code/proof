import { openaiJSON } from "@/lib/openai";
import { CREATOR_PERSONA } from "@/lib/persona";
import type {
  ContentBrief,
  ProjectUnderstanding,
  ReferenceStructure,
  Scene,
  ScriptOutput,
} from "@/lib/types";

// The second moat prompt - and the demo's money shot. We generate the SAME video
// idea two ways: a grounded script (persona + trend-grounded brief + the proven
// reference structure) and a deliberately naive baseline. Shown side-by-side, the
// grounded one should read visibly sharper.

const SCENE_SHAPE = `Each scene:
{ "id": "s1", "spokenLine": "what's said on camera", "overlay": { "text": "ONE short on-screen phrase", "style": "pop" | "subtle" | "stat" } | null, "brollCue": "optional: what to show" }
Return ONLY JSON: { "scenes": [Scene], "estimatedSeconds": number }`;

const GROUNDED_SYSTEM = `You are writing a short-form vertical video script (TikTok/Reels) for a specific creator.

CREATOR PERSONA:
${CREATOR_PERSONA}

You are given a BUILDER_PROFILE, a grounded CONTENT_BRIEF (already tied to a real trend with sources), and a REFERENCE_STRUCTURE (a proven high-performer).

Rules:
- Speak in the persona's voice: relatable, technical-but-accessible, first person, a little self-deprecating, never corporate.
- Inherit the REFERENCE_STRUCTURE's hook pattern and pacing - transfer the SHAPE, not its words.
- Open on the trend / a result / a contrarian claim from the brief. NEVER open with "Hi, today I'll show you" or "In this video".
- One filmable scene per beat. EXACTLY ONE overlay phrase per scene (or null) - overlays are short and punchy.
- Total runtime ~20-30 seconds. Set estimatedSeconds honestly.
- Ground every line in the brief's real substance (the trend, the actual project, real tech). No filler.

${SCENE_SHAPE}`;

const GENERIC_SYSTEM = `Write a short TikTok script about this app.

${SCENE_SHAPE}`;

function normalize(output: ScriptOutput): ScriptOutput {
  const scenes: Scene[] = (Array.isArray(output.scenes) ? output.scenes : []).map((s, i) => ({
    id: s.id || `s${i + 1}`,
    spokenLine: s.spokenLine ?? "",
    overlay:
      s.overlay && typeof s.overlay.text === "string" && s.overlay.text.trim()
        ? {
            text: s.overlay.text,
            style: (["pop", "subtle", "stat"] as const).includes(
              s.overlay.style as "pop" | "subtle" | "stat",
            )
              ? s.overlay.style
              : "pop",
          }
        : null,
    brollCue: s.brollCue || undefined,
  }));
  const estimatedSeconds =
    typeof output.estimatedSeconds === "number" && output.estimatedSeconds > 0
      ? Math.round(output.estimatedSeconds)
      : Math.max(15, scenes.length * 4);
  return { scenes, estimatedSeconds };
}

/** The grounded script: persona + trend-grounded brief + reference structure. */
export async function generateScript(args: {
  understanding: ProjectUnderstanding;
  brief: ContentBrief;
  structure: ReferenceStructure;
}): Promise<ScriptOutput> {
  const user = JSON.stringify({
    BUILDER_PROFILE: args.understanding,
    CONTENT_BRIEF: args.brief,
    REFERENCE_STRUCTURE: args.structure,
  });
  const out = await openaiJSON<ScriptOutput>({ system: GROUNDED_SYSTEM, user });
  return normalize(out);
}

/**
 * The deliberately naive baseline: only a one-liner about the app, with a generic
 * prompt and no persona / trend / structure. This is the weak side of the
 * side-by-side comparison.
 */
export async function generateGenericScript(args: {
  understanding: ProjectUnderstanding;
}): Promise<ScriptOutput> {
  const user = JSON.stringify({ app: args.understanding.oneLiner });
  const out = await openaiJSON<ScriptOutput>({ system: GENERIC_SYSTEM, user });
  return normalize(out);
}

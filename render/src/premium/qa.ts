import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOpenAI } from "../openai.js";
import { buildCutVideo, compositeOverlaySlice, overlayScenesAtOffsets, extractFrames } from "../ffmpeg.js";
import type {
  SceneBackgroundTreatment,
  SceneSpec,
  SceneQA,
  SceneIssue,
  SceneMode,
} from "../types.js";
import { chatTuning, premiumRequestOptions } from "./model-params.js";

export const DEFAULT_PREMIUM_QA_MODEL = "gpt-5.6-sol";
const QA_MODEL = process.env.PREMIUM_QA_MODEL || DEFAULT_PREMIUM_QA_MODEL;
const QA_EFFORT = process.env.PREMIUM_QA_EFFORT; // default "low" via chatTuning

/**
 * The QA rubric, grounded in what was ACTUALLY staged for this scene.
 *
 * Why this is a function: with zero staged assets the reviewer demanded "a real GitHub commit-graph
 * screenshot" / "the actual Proof screen recording" — materials that did not exist in the run, so no
 * re-author could satisfy it and the scene burned every retry (verified on proof-live-c063e1e6:
 * 5 scenes planned, 0 assets staged, 5/5 rejected, 3 of them for unstageable assets). QA may now only
 * demand assets that are on disk, and the example fixes are conditional so they never suggest
 * embedding a file that was never staged.
 */
export function qaSystemPrompt(
  assetHints: string[] = [],
  mode: SceneMode = "overlay",
  backgroundTreatment: SceneBackgroundTreatment = "footage",
): string {
  const hasAssets = assetHints.length > 0;
  const assetRule = hasAssets
    ? `STAGED ASSETS for this scene: ${assetHints.join(", ")}. When the intent names one, the scene must embed
  the real image — fail a scene that merely describes an asset instead of showing it. Demand ONLY assets from
  that list, by filename.`
    : `NO assets are staged for this scene. Judge it on layout, typography, motion and design craft. Do NOT
  demand real screenshots, recordings, photos or logos, and do NOT fail the scene for using a recreated UI,
  chart or diagram instead of a real capture — a well-built recreated visual is the CORRECT outcome here.`;
  if (mode === "full-frame" && backgroundTreatment === "black") {
    return `You are the SECOND-PASS creative director for a creator-native FULL-FRAME motion scene in a
vertical (1080x1920) video. The speaker is intentionally absent; hiding the face is NOT a fault. Captions are
composited above the scene. You are an ADVISOR, not a gatekeeper: the scene WILL ship regardless of verdict.

SAFETY = only objective broken output: misspelled or garbled text, clipped wordmarks, duplicated subtitle
sentences, empty frames, illegible overlaps, or text too small / low-contrast to read.

SUBJECTIVE = taste and density: weak hierarchy, less than roughly 35-50% negative space, excessive dashboards,
nested cards, tiny labels, several equal focal systems, decorative motion, generic visuals, or polish preferences.
Subjective issues NEVER block and NEVER drive an automatic re-author.

${assetRule}
Every issue must be one CONCRETE EDIT to the existing scene, never "start over". When unsure, tag it
"subjective". Respond with JSON: { "issues": [ { "text": string, "kind": "safety" | "subjective" } ] }.
Return an EMPTY issues array when the scene is clean, readable, restrained, and caption-clear.`;
  }
  if (mode === "full-frame") {
    return `You are the SECOND-PASS creative director for a creator-native FULL-FRAME motion scene composited
over visible talking-head footage in a vertical (1080x1920) video. The speaker remains visible and captions are
composited above the scene. You are an ADVISOR, not a gatekeeper: the scene WILL ship regardless of verdict.

SAFETY = only objective broken output: required wording from the intent that is missing, clipped, partially erased,
or unreadably small; essential text below 56px; any element covering the bottom caption band; misspelled or garbled
text; clipped wordmarks; duplicated subtitle sentences; empty frames; illegible overlaps; or low-contrast text.
Face overlap is allowed and is never a safety fault. Readability wins over keeping the speaker's face clear.

SUBJECTIVE = taste and density: weak hierarchy, excessive dashboards, nested cards, tiny labels, several equal
focal systems, decorative motion, generic visuals, or polish preferences. Subjective issues NEVER block and NEVER
drive an automatic re-author.

${assetRule}
Every issue must be one CONCRETE EDIT to the existing scene, never "start over". When unsure, tag it
"subjective". Respond with JSON: { "issues": [ { "text": string, "kind": "safety" | "subjective" } ] }.
Return an EMPTY issues array when the scene is clean, readable, restrained, and caption-clear.`;
  }
  const examples = hasAssets
    ? `("embed ./assets/${assetHints[0]} for real, don't just name it", "move the title fully into the left rail", "fix 'Triger.dev' -> 'Trigger.dev'")`
    : `("move the strip off the speaker's chin into the header", "give the chart a real axis instead of bare labels", "fix 'Triger.dev' -> 'Trigger.dev'")`;
  return `You are the SECOND-PASS creative director for a bespoke motion-graphic scene composited over
talking-head footage in a vertical (1080x1920) marketing video, captions already burned in at the bottom. You
are an ADVISOR, not a gatekeeper: the scene WILL ship regardless of your verdict. Your job is to report every
issue AND tag each one as "safety" or "subjective", because the two are handled completely differently:

SAFETY = an OBJECTIVE defect a reasonable person calls broken. These get auto-repaired. Only these:
- required wording named in the scene intent that is missing, clipped, partially erased, or unreadably small.
  Essential overlay wording must be at least 56px at 1080x1920. Face overlap is allowed: readability wins, so
  never request smaller, abbreviated, hidden, or replacement wording merely to keep the face clear.
- any element reaching into the bottom caption band and covering the burned-in captions.
- MISSPELLED or garbled on-screen text, or a CLIPPED / cut-off wordmark (e.g. "Compositin" for "Compositing").
- DISTORTED editorial type from a bad/unavailable display font: crushed or malformed glyphs (e.g. "WHO"
  rendering as "VHO"), or a headline left in inconsistent MIXED CASE (e.g. "Try Proof") that should read as
  clean uniform type. Ask for a clean installed sans (Arial/Liberation Sans) at the intended uniform case.
- reproducing the spoken sentence as on-screen subtitles / duplicating the bottom captions.
- a genuinely broken render: empty, elements overlapping into illegibility, or text too small / low-contrast to read.

SUBJECTIVE = a matter of TASTE. NEVER a reason to block — the HUMAN decides. Tag, don't fix. These:
- the scene is a bit generic, or could show a more specific/real visual (still legible and correctly spelled).
- a creative beat wasn't fully realized (e.g. "the chip could have morphed into a nameplate").
- a COPY / WORDING preference on text that is already correct and correctly spelled (e.g. word ORDER like
  "PROOF EDITED BY" vs "EDITED BY PROOF"), phrasing, or a pacing/aesthetic polish suggestion.
${assetRule}
Every issue is one CONCRETE EDIT to the EXISTING scene ("move the timeline panel up into the header row",
"fix 'Triger.dev' -> 'Trigger.dev'") — never "start over". Do NOT invent safety issues; when unsure whether
something is safety or subjective, tag it "subjective". A clean, legible, face-clear, caption-clear scene has
NO issues at all. Respond with JSON: { "issues": [ { "text": string, "kind": "safety" | "subjective" } ] }.
Each text is one short edit ${examples}. Return an EMPTY issues array when the scene is good to ship as-is.`;
}

export function qaSampleTimes(durationSec: number): number[] {
  return [0.05, 0.2, 0.5, 0.85, 0.95].map((ratio) =>
    Number((durationSec * ratio).toFixed(3)),
  );
}

export function qaImagePart(dataUrl: string) {
  return {
    type: "image_url" as const,
    // GPT-5.6 treats explicit auto as original detail. The Chat Completions SDK type
    // currently exposes auto but not the equivalent original literal.
    image_url: { url: dataUrl, detail: "auto" as const },
  };
}

/**
 * Render→look→re-render QA for one scene. Composites the scene MOV onto just its window of the
 * base clip, samples 5 frames, and asks GPT-5.6 vision to approve or return concrete fixes. The
 * fixes feed back into authorScene for a re-render. This is the loop that kills the slop.
 */
export async function qaScene(args: {
  spec: SceneSpec;
  movPath: string;
  basePath: string;
  captionOverlayPath?: string;
  workDir: string;
  /** Filenames actually staged for this scene; QA may only demand these. */
  assetHints?: string[];
}): Promise<SceneQA> {
  const { spec, movPath, basePath, captionOverlayPath, workDir, assetHints = [] } = args;
  const durSec = spec.durMs / 1000;

  // 1. Base window [anchor, anchor+dur] with the scene overlaid at offset 0.
  const baseWin = join(workDir, `${spec.id}-basewin.mp4`);
  const sceneComposite = join(workDir, `${spec.id}-scene-composite.mp4`);
  const qaComposite = join(workDir, `${spec.id}-qa.mp4`);
  await buildCutVideo(basePath, [{ startMs: spec.anchorMs, endMs: spec.anchorMs + spec.durMs }], baseWin);
  const backgroundTreatment = spec.backgroundTreatment ?? "footage";
  await overlayScenesAtOffsets(
    baseWin,
    [{ movPath, startMs: 0, endMs: spec.durMs, backgroundTreatment }],
    sceneComposite,
  );
  if (captionOverlayPath) {
    await compositeOverlaySlice(sceneComposite, captionOverlayPath, spec.anchorMs, spec.durMs, qaComposite);
  } else {
    await overlayScenesAtOffsets(
      baseWin,
      [{ movPath, startMs: 0, endMs: spec.durMs, backgroundTreatment }],
      qaComposite,
    );
  }

  // 2. Sample frames across the window.
  const frames = await extractFrames(
    qaComposite,
    qaSampleTimes(durSec),
    workDir,
    `${spec.id}-frame`,
  );

  // 3. Vision verdict.
  const images = await Promise.all(
    frames.map(async (f) => {
      const b64 = (await readFile(f)).toString("base64");
      return qaImagePart(`data:image/png;base64,${b64}`);
    }),
  );

  const client = getOpenAI();
  const resp = await client.chat.completions.create({
    model: QA_MODEL,
    ...chatTuning(QA_MODEL, QA_EFFORT),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: qaSystemPrompt(assetHints, spec.mode, backgroundTreatment) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Scene intent: ${spec.intent}\nThe footage already shows these spoken words as bottom captions (the scene must NOT repeat them as subtitles): ${spec.captionText}\nReview the ${frames.length} frames.`,
          },
          ...images,
        ],
      },
    ],
  }, premiumRequestOptions());

  return parseQaVerdict(resp.choices[0]?.message?.content);
}

/**
 * Parse the vision model's JSON verdict into a tagged outcome. Wire format:
 * `{ issues: [{ text, kind: "safety" | "subjective" }] }`. Each issue is normalized to a
 * {@link SceneIssue}; a missing/invalid kind defaults to "subjective" (fail toward showing the
 * human, never toward a wrong auto-repair — matches the prompt's "when unsure, subjective").
 *
 * - `operational_error` — empty or unparseable response. FAILS toward a cheap re-review: the caller
 *   retries the JUDGMENT on the SAME render rather than re-authoring, so a transient hiccup costs a
 *   re-review, not a wasted re-render.
 * - `approved` — no issues.
 * - `editorial_reject` — one or more tagged issues (safety and/or subjective).
 */
export function parseQaVerdict(content: string | null | undefined): SceneQA {
  if (!content) {
    return { outcome: "operational_error", issues: [{ text: "QA returned an empty response", kind: "subjective" }] };
  }
  try {
    const parsed = JSON.parse(content) as { issues?: unknown };
    const issues: SceneIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((raw): SceneIssue | null => {
            if (typeof raw === "string") return raw.trim() ? { text: raw.trim(), kind: "subjective" } : null;
            if (raw && typeof raw === "object") {
              const text = String((raw as { text?: unknown }).text ?? "").trim();
              if (!text) return null;
              const kind = (raw as { kind?: unknown }).kind === "safety" ? "safety" : "subjective";
              return { text, kind };
            }
            return null;
          })
          .filter((x): x is SceneIssue => x !== null)
      : [];
    if (issues.length === 0) return { outcome: "approved", issues: [] };
    return { outcome: "editorial_reject", issues };
  } catch {
    return { outcome: "operational_error", issues: [{ text: "QA returned unparseable JSON", kind: "subjective" }] };
  }
}

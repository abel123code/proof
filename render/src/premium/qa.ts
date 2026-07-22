import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOpenAI } from "../openai.js";
import { buildCutVideo, overlayScenesAtOffsets, extractFrames } from "../ffmpeg.js";
import type { SceneSpec, SceneQA } from "../types.js";
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
export function qaSystemPrompt(assetHints: string[] = []): string {
  const hasAssets = assetHints.length > 0;
  const assetRule = hasAssets
    ? `STAGED ASSETS for this scene: ${assetHints.join(", ")}. When the intent names one, the scene must embed
  the real image — fail a scene that merely describes an asset instead of showing it. Demand ONLY assets from
  that list, by filename.`
    : `NO assets are staged for this scene. Judge it on layout, typography, motion and design craft. Do NOT
  demand real screenshots, recordings, photos or logos, and do NOT fail the scene for using a recreated UI,
  chart or diagram instead of a real capture — a well-built recreated visual is the CORRECT outcome here.`;
  const examples = hasAssets
    ? `("embed ./assets/${assetHints[0]} for real, don't just name it", "move the title fully into the left rail", "fix 'Triger.dev' -> 'Trigger.dev'")`
    : `("move the strip off the speaker's chin into the header", "give the chart a real axis instead of bare labels", "fix 'Triger.dev' -> 'Trigger.dev'")`;
  return `You are a ruthless art director reviewing frames of a bespoke motion-graphic scene
composited over talking-head footage in a vertical (1080x1920) marketing video. The footage ALREADY has
burned-in captions along the bottom. Judge ONLY what you can see. FAIL the scene for:
- IT'S JUST TEXT. A headline/label on a background with no real visual is the #1 failure. A scene must
  SHOW something concrete — an embedded staged asset, a recreated UI element, a chart, a diagram — not merely words.
- reproducing the spoken sentence as on-screen subtitles / duplicating the bottom captions
- misspelled or garbled on-screen text
- text/graphics clipped at an edge, overlapping badly, or unreadable (too small / low contrast)
- any text or graphic touching the speaker's face, forehead, eyes, mouth, chin or head, wherever the speaker appears
- graphics covering the bottom caption band
- empty/broken render (nothing meaningful on screen) or obvious AI-slop layout
${assetRule}
Respond with JSON: { "ok": boolean, "issues": string[] }. Each issue is a SHORT concrete fix
${examples}. Return an empty issues array when the scene is good.`;
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
  workDir: string;
  /** Filenames actually staged for this scene; QA may only demand these. */
  assetHints?: string[];
}): Promise<SceneQA> {
  const { spec, movPath, basePath, workDir, assetHints = [] } = args;
  const durSec = spec.durMs / 1000;

  // 1. Base window [anchor, anchor+dur] with the scene overlaid at offset 0.
  const baseWin = join(workDir, `${spec.id}-basewin.mp4`);
  const qaComposite = join(workDir, `${spec.id}-qa.mp4`);
  await buildCutVideo(basePath, [{ startMs: spec.anchorMs, endMs: spec.anchorMs + spec.durMs }], baseWin);
  await overlayScenesAtOffsets(baseWin, [{ movPath, startMs: 0, endMs: spec.durMs }], qaComposite);

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
      { role: "system", content: qaSystemPrompt(assetHints) },
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
 * Parse the vision model's JSON verdict. FAILS CLOSED: an empty or unparseable response returns
 * ok:false, so a transient OpenAI/JSON hiccup makes produceScene retry and then SKIP the scene
 * rather than shipping an un-reviewed scene as if it were approved. Approval requires an explicit
 * ok:true with no issues.
 */
export function parseQaVerdict(content: string | null | undefined): SceneQA {
  if (!content) return { ok: false, issues: ["QA returned an empty response"] };
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; issues?: unknown };
    const reported = Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean) : [];
    const issues = parsed.ok === false && reported.length === 0
      ? ["QA rejected the scene without reasons"]
      : reported;
    return { ok: parsed.ok === true && issues.length === 0, issues };
  } catch {
    return { ok: false, issues: ["QA returned unparseable JSON"] };
  }
}

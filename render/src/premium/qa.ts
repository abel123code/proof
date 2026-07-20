import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOpenAI } from "../openai.js";
import { buildCutVideo, overlayScenesAtOffsets, extractFrames } from "../ffmpeg.js";
import type { SceneSpec, SceneQA } from "../types.js";
import { chatTuning, premiumRequestOptions } from "./model-params.js";

export const DEFAULT_PREMIUM_QA_MODEL = "gpt-5.6-sol";
const QA_MODEL = process.env.PREMIUM_QA_MODEL || DEFAULT_PREMIUM_QA_MODEL;
const QA_EFFORT = process.env.PREMIUM_QA_EFFORT; // default "low" via chatTuning

const QA_SYSTEM = `You are a ruthless art director reviewing frames of a bespoke motion-graphic scene
composited over talking-head footage in a vertical (1080x1920) marketing video. The footage ALREADY has
burned-in captions along the bottom. Judge ONLY what you can see. FAIL the scene for:
- IT'S JUST TEXT. A headline/label on a background with no real visual is the #1 failure. A scene must
  SHOW something concrete — the product screenshot, the logos, a UI element, a chart — not merely words.
- reproducing the spoken sentence as on-screen subtitles / duplicating the bottom captions
- misspelled or garbled on-screen text
- text/graphics clipped at an edge, overlapping badly, or unreadable (too small / low contrast)
- any text or graphic touching the speaker's face, forehead, eyes, or head, wherever the speaker appears
- graphics covering the bottom caption band
- empty/broken render (nothing meaningful on screen) or obvious AI-slop layout
Respond with JSON: { "ok": boolean, "issues": string[] }. Each issue is a SHORT concrete fix
("embed the actual screenshot, don't just name it", "move the title fully to the left rail",
"fix 'Triger.dev' -> 'Trigger.dev'"). Return an empty issues array when the scene is good.`;

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
}): Promise<SceneQA> {
  const { spec, movPath, basePath, workDir } = args;
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
      { role: "system", content: QA_SYSTEM },
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

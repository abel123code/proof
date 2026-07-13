import { getOpenAI } from "../openai.js";
import type { RenderBrief, Word, SceneSpec } from "../types.js";

const PLAN_MODEL = process.env.PREMIUM_PLAN_MODEL || "gpt-4o";

const MIN_SCENE_MS = 1500;
const MAX_SCENE_MS = 6000;
const MAX_SCENES = 6;

interface RawScene {
  anchorMs?: number;
  durMs?: number;
  intent?: string;
  captionText?: string;
}

const SYSTEM = `You are the storyboard director for a short-form VERTICAL (1080x1920) developer-marketing video.
The speaker is on camera the whole time; you design BESPOKE motion-graphic scenes that overlay on top of that
footage during the highest-impact moments (a product name, a metric, a before/after, a punchline).

Rules:
- Return 3 to ${MAX_SCENES} scenes. Do NOT cover every second — only the beats that deserve a custom visual.
- Each scene's anchorMs MUST equal the startMs of a real word from the provided timeline (snap to a word).
- Scenes must NOT overlap. Each is ${MIN_SCENE_MS}-${MAX_SCENE_MS} ms long and ends before totalMs.
- Carry the given recurring MOTIF through every scene (one object/shape that transforms) — this is what makes
  it read as "designed" rather than random overlays.
- "intent" is a precise brief for the scene author: what to show, the exact on-screen text, the key visual,
  how the motif appears, and which asset (if any) to feature. Reference assets by filename.
- "captionText" is the words spoken during the scene's window (copy them from the timeline).

Respond with JSON: { "scenes": [ { "anchorMs": number, "durMs": number, "intent": string, "captionText": string } ] }`;

/**
 * GPT storyboard: one call turns the script + word timings + assets into a handful of bespoke
 * scene specs anchored to real word boundaries. Everything the model returns is validated,
 * snapped to word starts, clamped, and de-overlapped before it can reach the renderer.
 */
export async function planScenes(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
}): Promise<SceneSpec[]> {
  const { brief, words, durationMs, assetHints } = args;
  if (words.length === 0) return [];

  const motif =
    brief.assets?.motif?.trim() ||
    "a single accent-colored shape (e.g. a chip/bar) that transforms across scenes";
  const wordStarts = words.map((w) => Math.round(w.startMs));

  const user = JSON.stringify({
    script: brief.script,
    motif,
    brandColor: brief.assets?.brandColor || brief.accentColor || null,
    brandVoice: brief.assets?.brandVoice || null,
    assets: assetHints,
    totalMs: durationMs,
    // Compact [startMs, text] timeline so the model can anchor to real word boundaries.
    timeline: words.map((w) => [Math.round(w.startMs), w.text]),
  });

  const client = getOpenAI();
  const resp = await client.chat.completions.create({
    model: PLAN_MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("planScenes: empty response");
  let raw: RawScene[];
  try {
    const parsed = JSON.parse(content) as { scenes?: RawScene[] };
    raw = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  } catch (e) {
    throw new Error(`planScenes: bad JSON (${(e as Error).message})`);
  }

  return normalizeScenes(raw, wordStarts, motif, durationMs);
}

/** Snap anchors to real word starts, clamp durations, sort, and drop overlaps. */
export function normalizeScenes(
  raw: RawScene[],
  wordStarts: number[],
  motif: string,
  durationMs: number,
): SceneSpec[] {
  const snap = (ms: number): number => {
    // Nearest word start at or before ms (a scene should start on a spoken word).
    let best = wordStarts[0] ?? 0;
    for (const s of wordStarts) {
      if (s <= ms && s >= best) best = s;
    }
    return best;
  };

  const cleaned = raw
    .filter((s) => typeof s.anchorMs === "number" && typeof s.durMs === "number")
    .map((s) => {
      const anchorMs = snap(Math.max(0, Math.round(s.anchorMs as number)));
      const durMs = Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, Math.round(s.durMs as number)));
      return {
        anchorMs,
        durMs,
        intent: (s.intent || "").trim(),
        captionText: (s.captionText || "").trim(),
      };
    })
    .filter((s) => s.intent.length > 0 && s.anchorMs < durationMs)
    .sort((a, b) => a.anchorMs - b.anchorMs);

  // Drop overlaps (keep the earlier scene) and clamp the tail to the video length.
  const out: SceneSpec[] = [];
  let cursor = 0;
  for (const s of cleaned) {
    if (out.length >= MAX_SCENES) break;
    if (s.anchorMs < cursor) continue; // overlaps the previous scene
    const end = Math.min(s.anchorMs + s.durMs, durationMs);
    const durMs = end - s.anchorMs;
    if (durMs < MIN_SCENE_MS) continue;
    out.push({
      id: `scene-${out.length + 1}`,
      anchorMs: s.anchorMs,
      durMs,
      motif,
      intent: s.intent,
      captionText: s.captionText,
    });
    cursor = end;
  }
  return out;
}

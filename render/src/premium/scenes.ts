import { getOpenAI } from "../openai.js";
import { chatTuning } from "./model-params.js";
import type { RenderBrief, Word, SceneSpec, RenderBriefScene } from "../types.js";

export const DEFAULT_PREMIUM_PLAN_MODEL = "gpt-5.6-sol";
const PLAN_MODEL = process.env.PREMIUM_PLAN_MODEL || DEFAULT_PREMIUM_PLAN_MODEL;
const PLAN_EFFORT = process.env.PREMIUM_PLAN_EFFORT; // default "low" via chatTuning

const MIN_SCENE_MS = 1500;
const MAX_SCENE_MS = 6000;
const MAX_SCENES = 6;
const DEFAULT_MOTIF = "a single accent-colored shape (e.g. a chip/bar) that transforms across scenes";

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
- The footage ALREADY has burned-in captions along the bottom, so scenes are NOT subtitles. "intent" is a precise
  brief for the scene author: what to show, a SHORT on-screen HEADLINE (a keyword/metric/label, ~2-5 words — NOT
  the full spoken sentence), the key visual, how the motif appears, and which asset (if any) to feature. Reference
  assets by filename.
- "captionText" is the words spoken during the scene's window (copy them from the timeline). This is CONTEXT for
  the author/reviewer only — it must NOT be pasted on screen as a subtitle.

Respond with JSON: { "scenes": [ { "anchorMs": number, "durMs": number, "intent": string, "captionText": string } ] }`;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string): string[] => norm(s).split(" ").filter(Boolean);

/**
 * Find where a brief scene's spokenLine occurs on the word timeline. Matches the line's first few
 * tokens as a run; falls back to the first single-token hit; returns null if nothing matches (the
 * caller then places the scene sequentially).
 */
export function findAnchorMs(spokenLine: string, words: Word[]): number | null {
  const target = tokens(spokenLine).slice(0, 4);
  if (target.length === 0 || words.length === 0) return null;
  const wt = words.map((w) => norm(w.text));
  for (let i = 0; i + target.length <= wt.length; i++) {
    if (target.every((t, k) => wt[i + k] === t)) return Math.round(words[i].startMs);
  }
  const j = wt.indexOf(target[0]);
  return j >= 0 ? Math.round(words[j].startMs) : null;
}

/** Turn one brief scene into a rich author directive: the visual idea + headline + which asset to feature. */
export function buildSceneIntent(scene: RenderBriefScene, assetHints: string[]): string {
  const cue = (scene.brollCue || "").trim() || (scene.label || "").trim() || "a bespoke visual for this beat";
  const headline = (scene.onScreenText || "").trim()
    ? ` The short on-screen headline is "${scene.onScreenText.trim()}" — everything else must be a real visual, not more text.`
    : "";
  const asset = assetHints.length
    ? ` Feature the provided asset(s) by embedding the real image: ${assetHints.join(", ")}.`
    : "";
  return `${cue}.${headline}${asset} Build a bespoke motion graphic around this beat — a headline-only card is NOT acceptable.`;
}

/**
 * Build SceneSpecs straight from the brief's own scenes (the human's visual ideas), anchoring each
 * to where its spokenLine lands on the word timeline. Reuses normalizeScenes for snap/clamp/de-overlap.
 */
export function scenesFromBrief(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
}): SceneSpec[] {
  const { brief, words, durationMs, assetHints } = args;
  const scenes = brief.scenes ?? [];
  const motif = brief.assets?.motif?.trim() || DEFAULT_MOTIF;
  const wordStarts = words.map((w) => Math.round(w.startMs));
  const span = Math.max(MIN_SCENE_MS, Math.floor(durationMs / Math.max(1, scenes.length)));

  let cursor = 0;
  const raw = scenes.map((s) => {
    const anchor = findAnchorMs(s.spokenLine || "", words) ?? cursor;
    const durMs = s.durationSeconds ? Math.round(s.durationSeconds * 1000) : span;
    cursor = anchor + durMs;
    return {
      anchorMs: anchor,
      durMs,
      intent: buildSceneIntent(s, assetHints),
      captionText: (s.spokenLine || "").trim(),
    };
  });

  return placeBriefScenes(raw, motif, durationMs);
}

/**
 * Place brief-derived scenes on the timeline PRESERVING ALL of them: they come from the human's
 * own storyboard in narrative order, so overlaps are NUDGED forward (anchor := end of the previous
 * scene) instead of dropped the way the LLM-storyboard path (normalizeScenes) drops them. Durations
 * are clamped; a scene is only dropped if the timeline is genuinely full (no room for the floor).
 */
export function placeBriefScenes(
  raw: Array<{ anchorMs: number; durMs: number; intent: string; captionText: string }>,
  motif: string,
  durationMs: number,
): SceneSpec[] {
  const out: SceneSpec[] = [];
  let cursor = 0;
  for (const s of raw) {
    if (!s.intent || !s.intent.trim()) continue;
    const anchor = Math.max(Math.round(s.anchorMs), cursor); // nudge past the previous scene, keep order
    if (anchor + MIN_SCENE_MS > durationMs) break; // no room left for even a floor-length scene
    const durMs = Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, Math.round(s.durMs)));
    const end = Math.min(anchor + durMs, durationMs);
    const finalDur = end - anchor;
    if (finalDur < MIN_SCENE_MS) break;
    out.push({
      id: `scene-${out.length + 1}`,
      anchorMs: anchor,
      durMs: finalDur,
      motif,
      intent: s.intent,
      captionText: s.captionText,
    });
    cursor = end;
  }
  return out;
}

/**
 * Turn the brief into bespoke scene specs anchored to real word boundaries. Prefers the brief's OWN
 * scenes (the human's visual ideas) — deterministic, no LLM call. Falls back to a GPT storyboard from
 * the script only when the brief carries no usable scenes. Everything is validated, snapped to word
 * starts, clamped, and de-overlapped before it can reach the renderer.
 */
export async function planScenes(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
}): Promise<SceneSpec[]> {
  const { brief, words, durationMs, assetHints } = args;
  if (words.length === 0) return [];

  // Prefer the brief's own scenes — deterministic, no LLM re-storyboard.
  if ((brief.scenes?.length ?? 0) > 0) {
    const fromBrief = scenesFromBrief({ brief, words, durationMs, assetHints });
    if (fromBrief.length > 0) return fromBrief;
    // else fall through to the LLM storyboard (e.g. none of the spokenLines could be anchored)
  }

  const motif = brief.assets?.motif?.trim() || DEFAULT_MOTIF;
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
    ...chatTuning(PLAN_MODEL, PLAN_EFFORT),
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

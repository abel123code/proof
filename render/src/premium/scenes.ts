import { getOpenAI } from "../openai.js";
import { chatTuning, premiumRequestOptions } from "./model-params.js";
import { DEFAULT_ACCENT } from "./accent.js";
import type {
  CreativeDirection,
  EditPlan,
  RenderBrief,
  RenderBriefScene,
  SceneBackgroundTreatment,
  SceneMode,
  SceneSpec,
  TimeInterval,
  Word,
} from "../types.js";

export const DEFAULT_PREMIUM_PLAN_MODEL = "gpt-5.6-sol";
const PLAN_MODEL = process.env.PREMIUM_PLAN_MODEL || DEFAULT_PREMIUM_PLAN_MODEL;
const PLAN_EFFORT = process.env.PREMIUM_PLAN_EFFORT; // default "low" via chatTuning

const MIN_SCENE_MS = 1500;
const MAX_SCENE_MS = 6000;
const MAX_SCENES = 6;
const DEFAULT_MOTIF = "a single accent-colored shape (e.g. a chip/bar) that transforms across scenes";
const FULL_FRAME_MAX_RATIO = 0.4;
const OVERLAY_MAX_RATIO = 0.35;
const ENHANCED_MAX_RATIO = 0.75;
const FACE_LED_EDGE_MS = 2000;
const FULL_FRAME_RECOVERY_MS = 1000;
const REQUIRED_CLEAN_INTERVAL_MS = 3000;

interface RawScene {
  anchorMs?: number;
  durMs?: number;
  intent?: string;
  captionText?: string;
}

export interface RawEditBeat extends RawScene {
  mode?: SceneMode | string;
  backgroundTreatment?: SceneBackgroundTreatment | string;
  priority?: number;
  rationale?: string;
}

export interface RawEditPlan {
  creativeDirection?: Partial<CreativeDirection>;
  beats?: RawEditBeat[];
}

const EDITORIAL_SYSTEM = `You are the global editorial director for a short creator-native vertical video.
The input contains the complete transcript timeline, the filmable content brief, brand hints, and staged assets.
Return ONE coherent edit plan. Decide which moments stay clean talking-head footage and which deserve graphics.

The visual modes are:
- overlay: the speaker stays visible and ONE visual authority sits OVER THE HEAD in the top region. That authority
  may be a bold editorial headline OR one compact element — a small labeled diagram, toggle, metric, or short
  animation — kept small and centered near the top. Reserve large multi-part explanations for full-frame.
- full-frame: the animation or real product evidence owns the frame because it explains a comparison, process,
  mechanism, timeline, state change, or proof artifact. Do not use full-frame merely for a noun.

Background treatment is a separate decision:
- footage: keep the recording visible behind the transparent animation. This is mandatory for overlays and the
  normal choice for top/side full-frame graphics that can use genuine negative space.
- black: hard-cut the recording to solid black behind a full-frame animation. Choose this only when the animation
  occupies most of the frame or must be the sole visual focus. Do not choose black merely to protect the face:
  large readable footage-backed wording may overlap the speaker when that produces the clearest mobile frame.

Creator-native doctrine:
- one visual authority per beat; replace graphics instead of stacking them;
- no dashboards, waveforms, scanner frames, status badges, decorative metadata, nested cards, or permanent chrome;
- meaningful animation may own the complete frame; supporting graphics stay small and singular;
- keep deliberate clean talking-head recovery; do not decorate every sentence;
- reuse one palette, typography system, spacing rhythm, and transition grammar across every beat;
- use real staged assets when they materially prove the claim; otherwise use a restrained conceptual visual.

Each asset in "assets" carries a "depicts" description of what it actually shows; "unknown" means its content
is not known, so it must NOT be treated as proof of a specific claim — fall back to a restrained conceptual visual.

Return JSON:
{
  "creativeDirection": {
    "backgroundColor": "#hex", "textColor": "#hex", "emphasisColor": "#hex",
    "successColor": "#hex", "failureColor": "#hex", "displayStyle": "short description",
    "technicalStyle": "short description", "transitionStyle": "short description", "motif": "short description"
  },
  "beats": [
    { "anchorMs": number, "durMs": number, "mode": "overlay" | "full-frame",
      "backgroundTreatment": "footage" | "black", "priority": 0-100,
      "intent": "precise visual instruction", "captionText": "spoken context", "rationale": "why this mode" }
  ]
}

Only include enhanced beats. Timeline gaps intentionally become clean A-roll. Anchor beats to real word starts,
avoid overlaps, keep each beat 1.5-6 seconds, and prefer 3-6 enhanced beats total.`;

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

/**
 * Turn one brief scene into a rich author directive: the visual idea + headline + which asset to
 * feature. `assetDescriptions` (keyed by filename, from the upload-time caption in
 * describe-image.ts) is optional and, when present, is folded into the asset mention so the author
 * learns not just WHICH file to embed but what it depicts and where its important content sits —
 * the crop the author must make, not just the file to place whole.
 */
export function buildSceneIntent(
  scene: RenderBriefScene,
  assetHints: string[],
  assetDescriptions: Record<string, string> = {},
): string {
  const cue = (scene.brollCue || "").trim() || (scene.label || "").trim() || "a bespoke visual for this beat";
  const headline = (scene.onScreenText || "").trim()
    ? ` The short on-screen headline is "${scene.onScreenText.trim()}" — render it as clean, premium editorial type.`
    : "";
  const asset = assetHints.length
    ? ` Feature the provided asset(s) by embedding the real image: ${assetHints
        .map((file) => (assetDescriptions[file] ? `${file} (${assetDescriptions[file]})` : file))
        .join(", ")}.`
    : "";
  return `${cue}.${headline}${asset} Build one bespoke, intentional visual authority for this beat — a bold editorial headline or one compact diagram/animation, not a generic decorated card.`;
}

function fallbackMode(scene: RenderBriefScene): SceneMode {
  const text = `${scene.label} ${scene.onScreenText} ${scene.brollCue}`.toLowerCase();
  return /before|after|versus|\bvs\b|compare|process|flow|pipeline|sequence|timeline|how it works|screen|demo|proof|walkthrough|state/.test(text)
    ? "full-frame"
    : "overlay";
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
  assetDescriptions?: Record<string, string>;
}): SceneSpec[] {
  const { brief, words, durationMs, assetHints, assetDescriptions } = args;
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
      intent: buildSceneIntent(s, assetHints, assetDescriptions),
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
      mode: "overlay",
      priority: 50,
      rationale: "legacy brief-scene placement",
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
  assetDescriptions?: Record<string, string>;
}): Promise<SceneSpec[]> {
  const { brief, words, durationMs, assetHints, assetDescriptions } = args;
  if (words.length === 0) return [];

  // Prefer the brief's own scenes — deterministic, no LLM re-storyboard.
  if ((brief.scenes?.length ?? 0) > 0) {
    const fromBrief = scenesFromBrief({ brief, words, durationMs, assetHints, assetDescriptions });
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
  }, premiumRequestOptions());

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
      mode: "overlay",
      priority: 50,
      rationale: "legacy storyboard scene",
      motif,
      intent: s.intent,
      captionText: s.captionText,
    });
    cursor = end;
  }
  return out;
}

function normalizeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function normalizeDirection(
  raw: Partial<CreativeDirection> | undefined,
  fallbackColor: string,
  fallbackMotif = DEFAULT_MOTIF,
): CreativeDirection {
  const emphasisColor = normalizeHex(raw?.emphasisColor, normalizeHex(fallbackColor, DEFAULT_ACCENT));
  return {
    backgroundColor: normalizeHex(raw?.backgroundColor, "#101114"),
    textColor: normalizeHex(raw?.textColor, "#ffffff"),
    emphasisColor,
    successColor: normalizeHex(raw?.successColor, "#79f28b"),
    failureColor: normalizeHex(raw?.failureColor, "#ff4f9a"),
    displayStyle: raw?.displayStyle?.trim() || "bold geometric sans serif with short editorial phrases",
    technicalStyle: raw?.technicalStyle?.trim() || "clean monospace reserved for code and product identifiers",
    transitionStyle: raw?.transitionStyle?.trim() || "hard cuts, short fades, and direct state replacement",
    motif: raw?.motif?.trim() || fallbackMotif,
  };
}

function complementIntervals(scenes: SceneSpec[], durationMs: number): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    if (scene.anchorMs > cursor) intervals.push({ startMs: cursor, endMs: scene.anchorMs });
    cursor = Math.max(cursor, scene.anchorMs + scene.durMs);
  }
  if (cursor < durationMs) intervals.push({ startMs: cursor, endMs: durationMs });
  return intervals;
}

function editCoverage(scenes: SceneSpec[], durationMs: number): EditPlan["coverage"] {
  const overlayMs = scenes
    .filter((scene) => scene.mode === "overlay")
    .reduce((sum, scene) => sum + scene.durMs, 0);
  const fullFrameMs = scenes
    .filter((scene) => scene.mode === "full-frame")
    .reduce((sum, scene) => sum + scene.durMs, 0);
  const cleanMs = Math.max(0, durationMs - overlayMs - fullFrameMs);
  const ratio = (value: number) => durationMs > 0 ? value / durationMs : 0;
  return {
    overlayMs,
    fullFrameMs,
    cleanMs,
    overlayRatio: ratio(overlayMs),
    fullFrameRatio: ratio(fullFrameMs),
    cleanRatio: ratio(cleanMs),
  };
}

export function normalizeEditPlan(args: {
  raw: RawEditPlan;
  words: Word[];
  durationMs: number;
  fallbackColor: string;
  fallbackMotif?: string;
}): EditPlan {
  const { raw, durationMs } = args;
  const wordStarts = [...new Set(args.words.map((word) => Math.round(word.startMs)))].sort((a, b) => a - b);
  const snapBefore = (ms: number): number => {
    let best = wordStarts[0] ?? 0;
    for (const start of wordStarts) {
      if (start > ms) break;
      best = start;
    }
    return best;
  };
  const snapAfter = (ms: number): number => wordStarts.find((start) => start >= ms) ?? ms;
  const direction = normalizeDirection(raw.creativeDirection, args.fallbackColor, args.fallbackMotif);

  const candidates = (Array.isArray(raw.beats) ? raw.beats : [])
    .filter((beat) => beat.mode === "overlay" || beat.mode === "full-frame")
    .filter((beat) => typeof beat.anchorMs === "number" && typeof beat.durMs === "number")
    .map((beat) => {
      const mode = beat.mode as SceneMode;
      const backgroundTreatment: SceneBackgroundTreatment =
        mode === "full-frame" && beat.backgroundTreatment === "black" ? "black" : "footage";
      let anchorMs = snapBefore(Math.max(0, Math.round(beat.anchorMs as number)));
      if (mode === "full-frame" && anchorMs < FACE_LED_EDGE_MS) anchorMs = snapAfter(FACE_LED_EDGE_MS);
      const maxEnd = mode === "full-frame"
        ? Math.max(0, durationMs - FACE_LED_EDGE_MS)
        : durationMs;
      const requested = Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, Math.round(beat.durMs as number)));
      const durMs = Math.min(requested, maxEnd - anchorMs);
      return {
        anchorMs,
        durMs,
        mode,
        backgroundTreatment,
        priority: Math.max(0, Math.min(100, Math.round(beat.priority ?? 50))),
        rationale: beat.rationale?.trim() || `planner selected ${mode}`,
        intent: beat.intent?.trim() || "",
        captionText: beat.captionText?.trim() || "",
      };
    })
    .filter((beat) => beat.intent && beat.durMs >= MIN_SCENE_MS && beat.anchorMs < durationMs);

  const fullFrameBudget = Math.floor(durationMs * FULL_FRAME_MAX_RATIO);
  const overlayBudget = Math.floor(durationMs * OVERLAY_MAX_RATIO);
  const enhancedBudget = Math.floor(durationMs * ENHANCED_MAX_RATIO);
  let usedFullFrame = 0;
  let usedOverlay = 0;
  let usedEnhanced = 0;
  const selected: typeof candidates = [];

  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority || a.anchorMs - b.anchorMs)) {
    if (selected.length >= MAX_SCENES) break;
    if (selected.some((scene) => candidate.anchorMs < scene.anchorMs + scene.durMs && scene.anchorMs < candidate.anchorMs + candidate.durMs)) {
      continue;
    }
    const modeRemaining = candidate.mode === "full-frame"
      ? fullFrameBudget - usedFullFrame
      : overlayBudget - usedOverlay;
    const allowed = Math.min(candidate.durMs, modeRemaining, enhancedBudget - usedEnhanced);
    if (allowed < MIN_SCENE_MS) continue;
    const accepted = { ...candidate, durMs: allowed };
    selected.push(accepted);
    usedEnhanced += allowed;
    if (candidate.mode === "full-frame") usedFullFrame += allowed;
    else usedOverlay += allowed;
  }

  const scheduled: SceneSpec[] = [];
  for (const candidate of selected.sort((a, b) => a.anchorMs - b.anchorMs)) {
    const previous = scheduled.at(-1);
    let anchorMs = candidate.anchorMs;
    if (previous?.mode === "full-frame" && candidate.mode === "overlay") {
      anchorMs = Math.max(anchorMs, snapAfter(previous.anchorMs + previous.durMs + FULL_FRAME_RECOVERY_MS));
    }
    const previousEnd = previous ? previous.anchorMs + previous.durMs : 0;
    if (anchorMs < previousEnd) continue;
    const maxEnd = candidate.mode === "full-frame"
      ? Math.max(0, durationMs - FACE_LED_EDGE_MS)
      : durationMs;
    const durMs = Math.min(candidate.durMs, maxEnd - anchorMs);
    if (durMs < MIN_SCENE_MS) continue;
    scheduled.push({
      id: "",
      anchorMs,
      durMs,
      mode: candidate.mode,
      backgroundTreatment: candidate.backgroundTreatment,
      priority: candidate.priority,
      rationale: candidate.rationale,
      motif: direction.motif,
      intent: candidate.intent,
      captionText: candidate.captionText,
    });
  }

  if (durationMs > 30000) {
    while (
      scheduled.length > 0 &&
      !complementIntervals(scheduled, durationMs).some((interval) => interval.endMs - interval.startMs >= REQUIRED_CLEAN_INTERVAL_MS)
    ) {
      const lowest = scheduled.reduce((best, scene, index, list) =>
        scene.priority < list[best].priority ? index : best, 0);
      scheduled.splice(lowest, 1);
    }
  }

  const scenes = scheduled
    .sort((a, b) => a.anchorMs - b.anchorMs)
    .map((scene, index) => ({ ...scene, id: `scene-${index + 1}` }));
  const cleanIntervals = complementIntervals(scenes, durationMs);
  return {
    creativeDirection: direction,
    scenes,
    cleanIntervals,
    coverage: editCoverage(scenes, durationMs),
  };
}

async function generateRawEditPlan(payload: string): Promise<RawEditPlan> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: PLAN_MODEL,
    ...chatTuning(PLAN_MODEL, PLAN_EFFORT),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EDITORIAL_SYSTEM },
      { role: "user", content: payload },
    ],
  }, premiumRequestOptions());
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("planEdit: empty response");
  try {
    return JSON.parse(content) as RawEditPlan;
  } catch (error) {
    throw new Error(`planEdit: bad JSON (${(error as Error).message})`);
  }
}

export async function planEdit(args: {
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  assetHints: string[];
  assetDescriptions?: Record<string, string>;
  generate?: (payload: string) => Promise<RawEditPlan>;
}): Promise<EditPlan> {
  const { brief, words, durationMs, assetHints } = args;
  const descriptions = args.assetDescriptions ?? {};
  const payload = JSON.stringify({
    script: brief.script,
    hook: brief.hook ?? null,
    targetFeeling: brief.targetFeeling ?? null,
    scenes: brief.scenes ?? [],
    brandColor: brief.assets?.brandColor || brief.accentColor || null,
    brandVoice: brief.assets?.brandVoice || null,
    motif: brief.assets?.motif || null,
    assets: assetHints.map((file) => ({ file, depicts: descriptions[file] ?? "unknown" })),
    totalMs: durationMs,
    timeline: words.map((word) => [Math.round(word.startMs), word.text]),
  });

  let raw: RawEditPlan;
  try {
    raw = await (args.generate ?? generateRawEditPlan)(payload);
  } catch {
    const briefScenes = brief.scenes ?? [];
    raw = {
      creativeDirection: {
        emphasisColor: brief.assets?.brandColor || brief.accentColor,
        motif: brief.assets?.motif,
      },
      beats: briefScenes.map((scene, index) => ({
        anchorMs: findAnchorMs(scene.spokenLine || "", words) ?? Math.round(index * durationMs / Math.max(1, briefScenes.length)),
        durMs: Math.round((scene.durationSeconds ?? 3) * 1000),
        mode: fallbackMode(scene),
        priority: Math.max(1, 100 - index * 10),
        intent: buildSceneIntent(scene, assetHints, descriptions),
        captionText: scene.spokenLine || "",
        rationale: "global planner failed; deterministic semantic fallback",
      })),
    };
  }

  return normalizeEditPlan({
    raw,
    words,
    durationMs,
    fallbackColor: brief.assets?.brandColor || brief.accentColor || DEFAULT_ACCENT,
    fallbackMotif: brief.assets?.motif || DEFAULT_MOTIF,
  });
}

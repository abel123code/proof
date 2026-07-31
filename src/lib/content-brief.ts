import { OPENAI_MINI_MODEL, openaiJSON } from "@/lib/openai";
import { CREATOR_PERSONA } from "@/lib/persona";
import {
  isStoryRole,
  normalizeEvidenceIds,
  STORY_ENGINE_VERSION,
} from "@/lib/story-frameworks";
import type {
  Angle,
  BriefDoc,
  BriefScene,
  InfoGap,
  Proof,
  ProjectUnderstanding,
  ReferencePattern,
} from "@/lib/types";

export interface BriefContext {
  understanding: ProjectUnderstanding | null;
  proof: Proof | null;
  /** The chosen scored angle (research path). */
  angle?: Angle | null;
  /** A freeform prompt (brand-new-video path). Used when there's no angle. */
  freeformPrompt?: string | null;
  references?: ReferencePattern[];
}

function contextPayload(ctx: BriefContext) {
  return {
    BUILDER_PROFILE: ctx.understanding
      ? {
          oneLiner: ctx.understanding.oneLiner,
          summary: ctx.understanding.summary,
          problem: ctx.understanding.problem,
          stack: ctx.understanding.stack,
          interesting: ctx.understanding.interesting,
          audience: ctx.understanding.audience,
          talkingPoints: ctx.understanding.talkingPoints,
        }
      : null,
    POSITIONING: ctx.proof,
    CHOSEN_ANGLE: ctx.angle
      ? {
          title: ctx.angle.title,
          hook: ctx.angle.hook,
          hookOptions: ctx.angle.hookOptions,
          hookArchetype: ctx.angle.hookArchetype,
          hookFormat: ctx.angle.hookFormat,
          alternateHookFormats: ctx.angle.alternateHookFormats,
          emotionalTrigger: ctx.angle.emotionalTrigger,
          storyLoops: ctx.angle.storyLoops,
          evidenceIds: ctx.angle.evidenceIds,
          coreIdea: ctx.angle.coreIdea,
          format: ctx.angle.format,
          targetDurationSeconds: ctx.angle.targetDurationSeconds,
          proofUsed: ctx.angle.proofUsed,
          sources: ctx.angle.sources,
        }
      : null,
    FREEFORM_PROMPT: ctx.freeformPrompt ?? null,
    REFERENCE_PATTERNS: (ctx.references ?? []).map((r) => ({
      hookType: r.hookType,
      format: r.format,
      structure: r.structure,
      whyShareable: r.whyShareable,
    })),
  };
}

function sourcesFor(ctx: BriefContext): string[] {
  return Array.from(new Set(ctx.angle?.sources ?? [])).slice(0, 6);
}

// ---- Step 1: find the info GitHub can't give us --------------------------------

const GAPS_SYSTEM = `${CREATOR_PERSONA}

You are about to write a concrete, scene-by-scene video brief that MARKETS this product to its target user, built on the CHOSEN_ANGLE (or FREEFORM_PROMPT), the product POSITIONING, and BUILDER_PROFILE.

Your job here is NOT to write the brief yet. It is to list the specific pieces of information you are MISSING - things GitHub cannot tell you but that you genuinely need to make the video relatable and convincing.

Ask 3-5 questions. Focus on: the target user's real, felt pain (a relatable moment/story), the concrete before -> after the product delivers, the single most convincing thing to SHOW as the product payoff, any real outcome/metric worth citing, and the call-to-action (where/how to try it). Frame everything around the viewer's problem, not the tech.

Do NOT ask things already answered by POSITIONING or the BUILDER_PROFILE. Keep each question short and answerable in one or two sentences.

Return ONLY JSON: { "questions": [ { "id": string (short slug), "question": string, "why": string, "placeholder": string } ] }.`;

export async function findInfoGaps(ctx: BriefContext): Promise<InfoGap[]> {
  const out = await openaiJSON<{ questions: InfoGap[] }>({
    model: OPENAI_MINI_MODEL,
    maxTokens: 3000,
    system: GAPS_SYSTEM,
    user: JSON.stringify(contextPayload(ctx)),
  });
  const questions = Array.isArray(out.questions) ? out.questions : [];
  return questions
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .slice(0, 6)
    .map((q, i) => ({
      id: (q.id && String(q.id)) || `q${i + 1}`,
      question: q.question.trim(),
      why: typeof q.why === "string" ? q.why.trim() : "",
      placeholder: typeof q.placeholder === "string" ? q.placeholder.trim() : undefined,
    }));
}

// ---- Step 2: draft the scene-by-scene brief ------------------------------------

const DRAFT_SYSTEM = `${CREATOR_PERSONA}

Write a filmable, scene-by-scene content brief for a short vertical (9:16) video whose goal is PRODUCT ADOPTION - make the viewer want to try the product - optimized for algorithmic satisfaction signals (completion, shares, saves, rewatches), not likes.

Build the script from the CHOSEN_ANGLE's evidence-backed story loops: hook -> stakes -> open question -> expected belief -> supported reversal -> visible payoff -> rehook when another loop follows -> CTA. Topic-driven, not tech-driven; jargon-light unless the target user is technical.

Use ALL of:
- CHOSEN_ANGLE: this is the strategy. Open on its selected hook, follow its storyLoops in order, resolve every openQuestion, and cite its evidenceIds in the relevant scenes. If there's no angle, use FREEFORM_PROMPT and create one complete loop.
- POSITIONING / BUILDER_PROFILE: lead with problemSpace + transformation for the targetUser; use receipts only as supporting proof where they earn a save. Do not lead with tech or invent numbers.
- REFERENCE_PATTERNS: mirror the proven pacing/beat shape - do NOT copy content.
- ANSWERS: the creator's answers to your earlier questions. Use these heavily.

Where an ANSWER is missing, make a modest, specific assumption and record it in "assumptions". Never invent numbers, fake urgency, unsupported scientific claims, or a reversal the evidence cannot support. First 3 seconds must earn the watch; one idea, fast pacing.

Each scene must be filmable: an exact spoken line, an on-screen text overlay (or empty string), a concrete b-roll / screen-recording cue, its storyRole, storyLoop number, and evidenceIds. Use 4-7 scenes, open on a strong hook, show the proof during the reversal/payoff, and close on a try-it CTA.

Return ONLY JSON matching:
{
  "title": string,
  "hook": string,
  "angle": string,
  "targetFeeling": string,
  "assumptions": [string],
  "scenes": [ {
    "scene": number,
    "label": string,
    "spokenLine": string,
    "onScreenText": string,
    "brollCue": string,
    "durationSeconds": number,
    "storyRole": "hook"|"stakes"|"question"|"expectation"|"reversal"|"proof"|"payoff"|"rehook"|"cta",
    "storyLoop": number,
    "evidenceIds": [string]
  } ]
}`;

function cleanSceneText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/\u001a/g, "→")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u0019\u001b-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBriefScenes(value: unknown): BriefScene[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((scene): scene is Record<string, unknown> => Boolean(scene && typeof scene === "object"))
    .map((scene, index) => ({
      scene: typeof scene.scene === "number" ? scene.scene : index + 1,
      label: cleanSceneText(scene.label, `Scene ${index + 1}`),
      spokenLine: cleanSceneText(scene.spokenLine),
      onScreenText: cleanSceneText(scene.onScreenText),
      brollCue: cleanSceneText(scene.brollCue),
      durationSeconds:
        typeof scene.durationSeconds === "number" ? scene.durationSeconds : undefined,
      storyRole: isStoryRole(scene.storyRole) ? scene.storyRole : undefined,
      storyLoop:
        typeof scene.storyLoop === "number" && Number.isInteger(scene.storyLoop) && scene.storyLoop > 0
          ? scene.storyLoop
          : undefined,
      evidenceIds: normalizeEvidenceIds(scene.evidenceIds),
    }));
}

export async function draftBriefDoc(
  ctx: BriefContext,
  gaps: InfoGap[],
  answers: Record<string, string>,
): Promise<BriefDoc> {
  const qa = gaps.map((g) => ({
    question: g.question,
    answer: answers[g.id]?.trim() || "(no answer given)",
  }));

  const out = await openaiJSON<BriefDoc>({
    model: OPENAI_MINI_MODEL,
    maxTokens: 7000,
    system: DRAFT_SYSTEM,
    user: JSON.stringify({ ...contextPayload(ctx), ANSWERS: qa }),
  });

  const scenes = normalizeBriefScenes(out.scenes);

  return {
    title: out.title ?? ctx.angle?.title ?? "Untitled brief",
    storyEngineVersion: STORY_ENGINE_VERSION,
    sourceAngleId: ctx.angle?.id,
    sourceHookFormat: ctx.angle?.hookFormat,
    hook: out.hook ?? ctx.angle?.hook ?? "",
    angle: out.angle ?? ctx.angle?.coreIdea ?? "",
    targetFeeling: out.targetFeeling ?? undefined,
    assumptions: Array.isArray(out.assumptions) ? out.assumptions.filter(Boolean) : [],
    scenes,
    sources: sourcesFor(ctx),
  };
}

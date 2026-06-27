import { openaiJSON } from "@/lib/openai";
import { CREATOR_PERSONA } from "@/lib/persona";
import type {
  BriefDoc,
  BriefScene,
  InfoGap,
  ProjectUnderstanding,
  ReferenceStructure,
  Trend,
} from "@/lib/types";

interface BriefContext {
  understanding: ProjectUnderstanding;
  trend: Trend;
  structure: ReferenceStructure;
  referenceCaption?: string | null;
}

function contextPayload(ctx: BriefContext) {
  return {
    BUILDER_PROFILE: {
      oneLiner: ctx.understanding.oneLiner,
      summary: ctx.understanding.summary,
      problem: ctx.understanding.problem,
      stack: ctx.understanding.stack,
      interesting: ctx.understanding.interesting,
      audience: ctx.understanding.audience,
      talkingPoints: ctx.understanding.talkingPoints,
      notableRepos: ctx.understanding.notableRepos?.map((r) => r.name),
    },
    TREND: {
      topic: ctx.trend.topic,
      whyTrending: ctx.trend.whyTrending,
      suggestedAngle: ctx.trend.suggestedAngle,
      sources: ctx.trend.sourceUrls,
    },
    REFERENCE_STRUCTURE: {
      hook: ctx.structure.hook,
      beats: ctx.structure.beats,
      pacing: ctx.structure.pacing,
      whyItWorks: ctx.structure.whyItWorks,
      caption: ctx.referenceCaption ?? null,
    },
  };
}

// ---- Step 1: find the info GitHub can't give us --------------------------------

const GAPS_SYSTEM = `${CREATOR_PERSONA}

You are about to write a concrete, personal, scene-by-scene video brief for this creator. You already have their GitHub-derived BUILDER_PROFILE, the TREND they want to ride, and the proven STRUCTURE of a reference TikTok.

Your job here is NOT to write the brief yet. It is to list the specific pieces of information you are MISSING - things GitHub cannot tell you but that you genuinely need to make the video personal and non-generic.

Ask 3-5 questions. Focus on things like: the creator's personal motivation / origin story, concrete results or metrics (users, stars, time saved), what exactly to show on screen / demo, their honest opinion or hot-take on the trend, who they're really speaking to, and anything that would otherwise force you to guess.

Do NOT ask things already answered by the BUILDER_PROFILE. Keep each question short and answerable in one or two sentences.

Return ONLY JSON: { "questions": [ { "id": string (short slug), "question": string, "why": string, "placeholder": string } ] }.`;

export async function findInfoGaps(ctx: BriefContext): Promise<InfoGap[]> {
  const out = await openaiJSON<{ questions: InfoGap[] }>({
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

Write a filmable, scene-by-scene content brief for a ~30-45 second vertical (9:16) video.

Use ALL of:
- TREND: ride this. The video should feel like it's part of this conversation.
- BUILDER_PROFILE: the creator's real work - use it as living proof, with specifics.
- REFERENCE_STRUCTURE: mirror its pacing and beat shape (the PROVEN structure), but do NOT copy its content.
- ANSWERS: the creator's answers to your earlier questions. Use these heavily - they make it personal.

Where an ANSWER is missing or blank, make a reasonable, specific assumption and record it in "assumptions" (so the creator can correct it). Never write vague filler.

Each scene must be filmable: an exact spoken line, an on-screen text overlay (or empty string), and a concrete b-roll / screen-recording cue. 4-7 scenes total, opening on a strong hook.

Return ONLY JSON matching:
{
  "title": string,
  "hook": string,
  "angle": string,
  "targetFeeling": string,
  "assumptions": [string],
  "scenes": [ { "scene": number, "label": string, "spokenLine": string, "onScreenText": string, "brollCue": string, "durationSeconds": number } ]
}`;

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
    system: DRAFT_SYSTEM,
    user: JSON.stringify({ ...contextPayload(ctx), ANSWERS: qa }),
  });

  const scenes: BriefScene[] = (Array.isArray(out.scenes) ? out.scenes : []).map((s, i) => ({
    scene: typeof s.scene === "number" ? s.scene : i + 1,
    label: typeof s.label === "string" ? s.label : `Scene ${i + 1}`,
    spokenLine: typeof s.spokenLine === "string" ? s.spokenLine : "",
    onScreenText: typeof s.onScreenText === "string" ? s.onScreenText : "",
    brollCue: typeof s.brollCue === "string" ? s.brollCue : "",
    durationSeconds:
      typeof s.durationSeconds === "number" ? s.durationSeconds : undefined,
  }));

  return {
    title: out.title ?? "Untitled brief",
    hook: out.hook ?? "",
    angle: out.angle ?? "",
    targetFeeling: out.targetFeeling ?? undefined,
    assumptions: Array.isArray(out.assumptions) ? out.assumptions.filter(Boolean) : [],
    scenes,
    sources: ctx.trend.sourceUrls ?? [],
  };
}

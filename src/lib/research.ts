// OpenAI web-search research and deterministic angle-ranking engine.
// North star: engineer for algorithmic satisfaction
// signals (completion, shares, saves, rewatches) - not likes. Every output is
// scored against known virality drivers and ranked.
//
// Cost model:
//   - extractProof / draft steps run on the CHEAP tier (OPENAI_MINI_MODEL).
//   - researchTopics / researchReferences use web search (OPENAI_SEARCH_MODEL).
//   - scoreAngles is the ONE premium call (OPENAI_TEXT_MODEL) - quality here
//     drives the whole outcome.
// Callers are responsible for caching (trends daily/global, references per-topic,
// proof per-commit) so these are only hit on explicit user action.

import {
  OPENAI_MINI_MODEL,
  OPENAI_TEXT_MODEL,
  openaiJSON,
  openaiWebSearchJSON,
} from "@/lib/openai";
import { CREATOR_PERSONA } from "@/lib/persona";
import type {
  Angle,
  Proof,
  ProjectUnderstanding,
  ReferencePattern,
  TrendTopic,
  ViralityScore,
} from "@/lib/types";

// ---- Step 1: repo intelligence / proof extraction (cheap tier) -----------

const PROOF_SYSTEM = `${CREATOR_PERSONA}

You turn a product (described by its BUILDER_PROFILE) into marketing POSITIONING: the raw material for topic-driven content that pulls in potential users.

Lead with the human, non-technical angle. Who actually has this problem? What real-world pain or desire does the product speak to? What changes for them after using it? Then find the relatable, culturally-resonant conversations the product can credibly ride to reach a general (non-engineer) audience - e.g. a resume/verification tool can ride "the job market is brutal right now", a SaaS tool can ride "why nobody sees your product". These topics are what keep content from being tech-heavy.

Keep receipts (hard numbers/demos) as SUPPORTING credibility only - do not lead with them, and never invent a number.

Return ONLY JSON:
{
  "targetUser": string,        // who feels the pain / who we want as a user
  "problemSpace": string,      // the real-world, non-technical problem or desire
  "transformation": string,    // the before -> after the product delivers
  "topics": [string],          // 3-6 relatable/cultural conversations the product can ride
  "receipts": [string],        // 0-6 concrete supporting proof points (numbers, demos) - optional
  "uniqueAngle": string,       // the single most differentiated thing about the product
  "story": string,             // the origin/why story in one or two lines
  "bestProofDrop": string      // the strongest single "screenshot this" fact (if any)
}`;

export async function extractProof(understanding: ProjectUnderstanding): Promise<Proof> {
  const out = await openaiJSON<Proof>({
    model: OPENAI_MINI_MODEL,
    maxTokens: 4000,
    system: PROOF_SYSTEM,
    user: JSON.stringify({
      BUILDER_PROFILE: {
        oneLiner: understanding.oneLiner,
        summary: understanding.summary,
        problem: understanding.problem,
        stack: understanding.stack,
        interesting: understanding.interesting,
        audience: understanding.audience,
        talkingPoints: understanding.talkingPoints,
        notableRepos: understanding.notableRepos?.map((r) => r.name),
      },
    }),
  });
  return {
    targetUser: out.targetUser ?? "",
    problemSpace: out.problemSpace ?? "",
    transformation: out.transformation ?? "",
    topics: Array.isArray(out.topics) ? out.topics.filter(Boolean).slice(0, 6) : [],
    receipts: Array.isArray(out.receipts) ? out.receipts.filter(Boolean).slice(0, 6) : [],
    uniqueAngle: out.uniqueAngle ?? "",
    story: out.story ?? "",
    bestProofDrop: out.bestProofDrop ?? "",
  };
}

// ---- Step 2: trend & demand research (web search, GLOBAL/shared) ---------

const TRENDS_SYSTEM = `You research the CURRENT conversations happening around a product's PROBLEM SPACE, so a maker can make topic-driven short-form video that pulls in potential users.

You are seeded with the product's TARGET_USER, PROBLEM_SPACE, and candidate TOPICS. Use web search to find CURRENT (last ~2 weeks) waves that this product's audience already cares about. Search BOTH:
- MAINSTREAM / cultural lanes: big relatable themes, news, and general-audience conversations the problem intersects (e.g. the job market, burnout, "AI is taking over", nobody-sees-my-work). This is where reach comes from.
- NICHE community lanes relevant to the target user (only lean developer/technical if the TARGET_USER is actually engineers).

Return two kinds of topics:
- TREND-JACKING: a current wave the product can credibly ride.
- CONTENT-GAP: high interest but little short-form video supply (blue ocean) - mark these contentGap: true.

Prefer topics a NON-technical viewer would instantly understand and share. Every topic MUST include 1-3 real, recent sourceUrls you actually found.

Return ONLY JSON:
{ "topics": [ { "topic": string, "whyTrending": string, "whereDiscussed": string, "sourceUrls": [string], "contentGap": boolean } ] }
Return 6-8 topics, strongest first.`;

/** Seed context that steers topic research toward the product's problem space. */
export interface TopicSeed {
  targetUser?: string;
  problemSpace?: string;
  topics?: string[];
}

/**
 * Problem-space topic research, seeded by the product's positioning. Runs on
 * explicit user action ("Run research") and is persisted per project by the
 * caller, so it's only hit on a cache miss / re-run.
 */
export async function researchTopics(seed: TopicSeed = {}): Promise<TrendTopic[]> {
  const out = await openaiWebSearchJSON<{ topics: TrendTopic[] }>({
    system: TRENDS_SYSTEM,
    maxTokens: 12000,
    user: JSON.stringify({
      TARGET_USER: seed.targetUser ?? null,
      PROBLEM_SPACE: seed.problemSpace ?? null,
      TOPICS: seed.topics ?? [],
      INSTRUCTION:
        "Find current, relatable conversations this product's audience cares about right now for topic-driven short-form video.",
    }),
  });
  return (Array.isArray(out.topics) ? out.topics : [])
    .filter((t) => t && typeof t.topic === "string" && t.topic.trim())
    .slice(0, 8)
    .map((t) => ({
      topic: t.topic.trim(),
      whyTrending: t.whyTrending ?? "",
      whereDiscussed: t.whereDiscussed ?? "",
      sourceUrls: Array.isArray(t.sourceUrls) ? t.sourceUrls.filter(Boolean).slice(0, 3) : [],
      contentGap: Boolean(t.contentGap),
    }));
}

// ---- Step 3: reference pattern mining (web search, cached per topic) -----

const REFERENCES_SYSTEM = `You find top-performing short-form videos (TikTok / Reels / Shorts / YouTube) about a given TOPIC and extract their transferable PATTERNS. The topic can be anything - a mainstream/cultural theme or a niche one - so do not assume a tech/developer audience. You do NOT download or watch the videos - you cite them and reason about what made them shareable.

Use web search to find real, well-performing examples that a general audience engaged with. For each, extract the pattern (NOT the content): hook type, format, structure/beats, and why it was shareable.

Return ONLY JSON:
{ "references": [ { "title": string, "url": string, "hookType": string, "format": string, "structure": string, "whyShareable": string } ] }
Return 3-5 references with real URLs.`;

export async function researchReferences(topic: string): Promise<ReferencePattern[]> {
  const out = await openaiWebSearchJSON<{ references: ReferencePattern[] }>({
    system: REFERENCES_SYSTEM,
    maxTokens: 10000,
    user: `Topic: ${topic}`,
  });
  return (Array.isArray(out.references) ? out.references : [])
    .filter((r) => r && typeof r.title === "string")
    .slice(0, 5)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      hookType: r.hookType ?? "",
      format: r.format ?? "",
      structure: r.structure ?? "",
      whyShareable: r.whyShareable ?? "",
    }));
}

// ---- Step 4: angle generation + virality scoring (PREMIUM, the one call) --

const ANGLES_SYSTEM = `${CREATOR_PERSONA}

You are a viral short-form strategist whose real goal is PRODUCT ADOPTION: angles that make a viewer want to try the product. Virality is engineered, not luck - optimize for algorithmic satisfaction signals (completion, shares, saves, rewatches), NOT likes.

Given the product's POSITIONING (targetUser, problemSpace, transformation, topics + supporting receipts), the chosen TOPIC (or a freeform prompt), and REFERENCE_PATTERNS, generate 3-5 distinct content angles. Score EACH on a 0-100 rubric and rank.

Hard rules:
- Topic-driven, NOT tech-driven. Lead with the relatable, real-world problem or desire; the product appears as the payoff/solution with a soft "try it" beat - it is not the subject.
- Jargon-light: a general (non-engineer) viewer must instantly get it. Only go technical if TARGET_USER is actually engineers.
- Use receipts only as supporting proof, never as the lead. Do not invent numbers.

Scoring dimensions (each 0-100):
- hook: strength, mapped to a proven archetype (hot-take, proof-drop, action-start, trend-reference, unanswerable-question)
- emotion: strength of the single emotional trigger (fear / empathy / outrage / curiosity / humor / aspiration)
- shareability: "would someone DM this to a friend?"
- saveability: is there something worth saving?
- trendFit: timeliness / topic fit
- relevance: how directly it speaks to the target user's real problem and pulls them toward the product
"total" is a weighted blend (hook, shareability, and relevance weigh most). Retention design (one idea, fast pacing) should push scores up.

For "proofUsed", name the piece of POSITIONING (problem, transformation, or a receipt) the angle leans on.

Return ONLY JSON:
{ "angles": [ {
  "title": string,
  "hook": string,
  "hookOptions": [string],            // 3-5 variations
  "hookArchetype": "hot-take"|"proof-drop"|"action-start"|"trend-reference"|"unanswerable-question",
  "emotionalTrigger": "fear"|"empathy"|"outrage"|"curiosity"|"humor"|"aspiration",
  "coreIdea": string,
  "whyShareable": string,
  "proofUsed": string,
  "format": string,
  "targetDurationSeconds": number,
  "why": string,
  "score": { "total": number, "hook": number, "emotion": number, "shareability": number, "saveability": number, "trendFit": number, "relevance": number }
} ] }`;

export async function scoreAngles(args: {
  proof: Proof | null;
  understanding: ProjectUnderstanding | null;
  topic?: TrendTopic | null;
  freeformPrompt?: string | null;
  references: ReferencePattern[];
}): Promise<Angle[]> {
  const sources = [
    ...(args.topic?.sourceUrls ?? []),
    ...args.references.map((r) => r.url).filter(Boolean),
  ];
  const out = await openaiJSON<{ angles: Angle[] }>({
    model: OPENAI_TEXT_MODEL,
    maxTokens: 8000,
    system: ANGLES_SYSTEM,
    user: JSON.stringify({
      POSITIONING: args.proof,
      PRODUCT_ONE_LINER: args.understanding?.oneLiner ?? null,
      TOPIC: args.topic ?? null,
      FREEFORM_PROMPT: args.freeformPrompt ?? null,
      REFERENCE_PATTERNS: args.references,
    }),
  });

  const angles = Array.isArray(out.angles) ? out.angles : [];
  return angles
    .filter((a) => a && typeof a.title === "string")
    .map((a, i) => normalizeAngle(a, i, sources))
    .sort((a, b) => b.score.total - a.score.total);
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function normalizeAngle(a: Angle, i: number, sources: string[]): Angle {
  const s = (a.score ?? {}) as Partial<ViralityScore>;
  const score: ViralityScore = {
    hook: clamp(s.hook),
    emotion: clamp(s.emotion),
    shareability: clamp(s.shareability),
    saveability: clamp(s.saveability),
    trendFit: clamp(s.trendFit),
    relevance: clamp(s.relevance),
    total: 0,
  };
  // Recompute total ourselves so the ranking is trustworthy. Product-adoption
  // north star: hook, shareability, and relevance (fit to the user's problem) weigh most.
  score.total = Math.round(
    score.hook * 0.26 +
      score.shareability * 0.22 +
      score.relevance * 0.2 +
      score.emotion * 0.14 +
      score.saveability * 0.1 +
      score.trendFit * 0.08,
  );
  const hookOptions = Array.isArray(a.hookOptions) ? a.hookOptions.filter(Boolean) : [];
  return {
    id: `angle-${i + 1}`,
    title: a.title ?? `Angle ${i + 1}`,
    hook: a.hook ?? hookOptions[0] ?? "",
    hookOptions: hookOptions.length ? hookOptions : a.hook ? [a.hook] : [],
    hookArchetype: a.hookArchetype ?? "proof-drop",
    emotionalTrigger: a.emotionalTrigger ?? "curiosity",
    coreIdea: a.coreIdea ?? "",
    whyShareable: a.whyShareable ?? "",
    proofUsed: a.proofUsed ?? "",
    format: a.format ?? "",
    targetDurationSeconds:
      typeof a.targetDurationSeconds === "number" ? a.targetDurationSeconds : 35,
    score,
    why: a.why ?? "",
    sources: Array.from(new Set(sources)).slice(0, 6),
  };
}

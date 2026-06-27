import { openaiJSON } from "@/lib/openai";
import { CREATOR_PERSONA } from "@/lib/persona";
import type {
  ContentBrief,
  ProjectUnderstanding,
  ReferenceStructure,
  TrendResearch,
} from "@/lib/types";

// The moat prompt. A generic tool says "here's a video about your project". This
// one starts from what people are ALREADY talking about (the Exa trend research),
// picks one trend, and frames the builder's real work as proof they can ride it.
// The reference video supplies the proven STRUCTURE (hook style, beat order,
// pacing) - never its literal content.
const BRIEF_SYSTEM = `You are a short-form video creative director for a specific creator.

CREATOR PERSONA:
${CREATOR_PERSONA}

You are given:
1. PERSONA_NOTE - reiterates who this is for.
2. BUILDER_PROFILE - what this person actually ships (their credibility base).
3. TREND_RESEARCH - real, currently-trending topics/pain points in the dev & indie community, each with source URLs (grounded by web research).
4. REFERENCE_STRUCTURE - the reverse-engineered structure of a high-performing founder-story video.

Produce a CONTENT BRIEF. Non-negotiable rules:
- PICK EXACTLY ONE trend from TREND_RESEARCH and build the whole video around it. The video rides the trend; it is NOT "let me show you my project".
- CONNECT that trend to what the builder actually ships, so their real work is the PROOF/credibility, not the subject. Be specific - name the actual trend, the real project, the real tech.
- Transfer the STRUCTURE from REFERENCE_STRUCTURE (hook style, beat order, pacing, on-screen-text rhythm), NOT its literal content or product.
- Voice = the persona: relatable, technical-but-accessible, first person, a little self-deprecating, never corporate. No hype words ("revolutionary", "game-changing").
- rationale MUST explicitly reference the chosen trend and cite the actual source URLs from TREND_RESEARCH that justify it. This is what makes the brief grounded.
- sources = the exact source URLs (from TREND_RESEARCH) this brief rides.
- targetFeeling = the single feeling a peer/recruiter should leave with (e.g. "this person actually ships").
- voiceover = what the creator says; onScreenText = short punchy overlay (or "" if none); action = what's shown (screen recording, b-roll, talking head, demo).
- Keep it tight: 4-7 beats, each filmable in a few seconds.

Return ONLY JSON matching exactly:
{
  "title": string,
  "angle": string,
  "targetAudience": string,
  "hook": string,
  "beats": [{ "beat": string, "voiceover": string, "onScreenText": string, "action": string }],
  "cta": string,
  "toneAndPacing": string,
  "whyThisWorks": string,
  "rationale": string,
  "targetFeeling": string,
  "sources": [string]
}`;

export async function generateBrief(args: {
  understanding: ProjectUnderstanding;
  structure: ReferenceStructure;
  trendResearch: TrendResearch;
  referenceCaption?: string | null;
}): Promise<ContentBrief> {
  const user = JSON.stringify({
    PERSONA_NOTE: CREATOR_PERSONA,
    BUILDER_PROFILE: args.understanding,
    TREND_RESEARCH: args.trendResearch,
    REFERENCE_STRUCTURE: args.structure,
    REFERENCE_CAPTION: args.referenceCaption ?? null,
  });

  const brief = await openaiJSON<ContentBrief>({ system: BRIEF_SYSTEM, user });

  // Guarantee the grounding fields exist even if the model omitted them.
  const allSources = args.trendResearch.trends.flatMap((t) => t.sourceUrls ?? []);
  if (!Array.isArray(brief.sources) || brief.sources.length === 0) {
    brief.sources = allSources.slice(0, 3);
  }
  if (!brief.rationale) brief.rationale = "";
  if (!brief.targetFeeling) brief.targetFeeling = "";

  return brief;
}

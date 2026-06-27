import { openaiJSON } from "@/lib/openai";
import type { ContentBrief, ProjectUnderstanding, ReferenceStructure } from "@/lib/types";

// The core blend (spec Phase 4): take a proven founder-story STRUCTURE and pour
// THIS product's real substance into it. We transfer the reference's shape - its
// hook style, beat order, pacing - not its words. The result is a filmable plan,
// not a final script.
const BRIEF_SYSTEM = `You are a short-form video creative director who helps software founders turn the story of what they built into a recruiter-facing UGC video (TikTok / Reels style).

You are given:
1. PROJECT - the AI understanding of a real software product the founder built.
2. REFERENCE_STRUCTURE - the reverse-engineered structure of a high-performing founder-story video.

Produce a CONTENT BRIEF that adapts the REFERENCE_STRUCTURE to showcase the PROJECT. Rules:
- Transfer the STRUCTURE (hook style, beat order, pacing, on-screen-text rhythm), NOT the reference's literal content or product.
- Every beat must be grounded in the PROJECT's real substance: its problem, what it does, the most interesting technical decision, and the talking points. Be specific - name the actual product, problem, and tech.
- First person, authentic, like the founder talking. No hype words like "revolutionary" or "game-changing".
- The video should make a recruiter or peer think "this person can build real things". Lean on the most interesting/technical angle.
- voiceover = what the founder says; onScreenText = short punchy overlay (or "" if none); action = what's shown (screen recording, b-roll, talking head, demo).
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
  "whyThisWorks": string
}`;

export async function generateBrief(args: {
  understanding: ProjectUnderstanding;
  structure: ReferenceStructure;
  referenceCaption?: string | null;
}): Promise<ContentBrief> {
  const user = JSON.stringify({
    PROJECT: args.understanding,
    REFERENCE_STRUCTURE: args.structure,
    REFERENCE_CAPTION: args.referenceCaption ?? null,
  });

  return openaiJSON<ContentBrief>({ system: BRIEF_SYSTEM, user });
}

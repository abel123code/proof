// Shared domain types for the Reverse-Engineer pipeline.
// These mirror the JSON payloads persisted in Supabase (see supabase/migrations).

/** Project understanding produced from a GitHub repo (Phase 2). */
export interface ProjectUnderstanding {
  /** One-line description of what the project is. */
  oneLiner: string;
  /** What the project does, in a few sentences. */
  summary: string;
  /** The primary problem it solves. */
  problem: string;
  /** Detected tech stack / notable libraries. */
  stack: string[];
  /** The single most technically interesting decision or feature. */
  interesting: string;
  /** Who would care about this (target audience). */
  audience: string;
  /** Short, punchy talking points usable in a script. */
  talkingPoints: string[];
}

/** A timestamped on-screen text moment detected in a reference video. */
export interface OnScreenText {
  /** Seconds from the start of the clip. */
  atSeconds: number;
  text: string;
}

/**
 * Structured breakdown of a reference video, produced by Gemini (Phase 3b).
 * This is the reusable "structure" that gets blended with project understanding.
 */
export interface ReferenceStructure {
  /** The hook: how the first ~3 seconds grab attention. */
  hook: string;
  /** Overall narrative/structure skeleton (ordered beats). */
  beats: string[];
  /** Pacing notes (cut frequency, energy, length). */
  pacing: string;
  /** On-screen text moments with rough timing. */
  onScreenText: OnScreenText[];
  /** What was said - the spoken content / VO summary. */
  spoken: string;
  /** What was done - actions, shots, visual technique. */
  visualTechnique: string[];
  /** Why this structure works (transferable insight, not "virality"). */
  whyItWorks: string;
}

/** One beat of the content brief: a filmable section adapted from the reference. */
export interface BriefBeat {
  /** Section name, e.g. "Hook", "The problem", "The build", "Payoff". */
  beat: string;
  /** What the founder says on camera / voiceover for this beat. */
  voiceover: string;
  /** Text overlay to show on screen during this beat (empty string if none). */
  onScreenText: string;
  /** What is shown / done on screen (b-roll, screen recording, action). */
  action: string;
}

/**
 * A content brief (Phase 4): the project understanding adapted into the proven
 * structure of a reference video, so the founder can film a video showcasing
 * their product. This is a PLAN, not a final script.
 */
export interface ContentBrief {
  /** Short internal title for this brief. */
  title: string;
  /** The core creative angle - how this product's story is framed. */
  angle: string;
  /** Who this video is for (recruiters + the product's natural audience). */
  targetAudience: string;
  /** The adapted hook (first ~3 seconds) tailored to this product. */
  hook: string;
  /** Ordered, filmable beats mirroring the reference structure. */
  beats: BriefBeat[];
  /** The closing call-to-action. */
  cta: string;
  /** Tone + pacing direction, adapted from the reference's pacing. */
  toneAndPacing: string;
  /** Why this structure showcases this specific product well. */
  whyThisWorks: string;
}

/** Keyword flagged in a script to receive an on-screen overlay (Phase 5). */
export interface KeywordFlag {
  phrase: string;
  /** Optional reason this phrase is emphasized. */
  emphasis?: string;
}

/** Word-level transcript entry from Whisper (Phase 7). */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

// ---- Database row shapes (snake_case columns mapped to camelCase in db.ts) ----

export interface Project {
  id: string;
  repoUrl: string;
  name: string;
  understanding: ProjectUnderstanding | null;
  createdAt: string;
}

/** A persisted brief row (blend of a project + a reference video). */
export interface Brief {
  id: string;
  projectId: string;
  referenceVideoId: string | null;
  content: ContentBrief | null;
  createdAt: string;
}

export type ReferenceAnalysisStatus = "pending" | "analyzing" | "analyzed" | "error";

export interface ReferenceVideo {
  id: string;
  /** Canonical TikTok URL. */
  url: string;
  /** Direct downloadable video URL from Apify (may expire). */
  downloadUrl: string | null;
  author: string | null;
  caption: string | null;
  views: number | null;
  likes: number | null;
  /** Which genre query/hashtag this clip matched (for "why relevant"). */
  matchedQuery: string | null;
  status: ReferenceAnalysisStatus;
  structure: ReferenceStructure | null;
  createdAt: string;
}

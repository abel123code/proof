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
  /**
   * Standout public repos for the builder profile (account-level analysis).
   * Empty for older, single-repo projects.
   */
  notableRepos: NotableRepo[];
}

/** A standout repo surfaced for an account-level builder profile. */
export interface NotableRepo {
  name: string;
  url: string;
  description: string;
}

/**
 * One trending topic / pain point the dev & indie-maker community is discussing
 * right now, surfaced by grounded web research with real source URLs.
 */
export interface Trend {
  /** The trending topic or pain point, stated plainly. */
  topic: string;
  /** Why this is bubbling up right now. */
  whyTrending: string;
  /** Where it's being discussed, e.g. "r/webdev", "Hacker News", "X". */
  whereDiscussed: string;
  /** Real, recent source URLs backing this trend (1-3). */
  sourceUrls: string[];
  /** One-line "how this builder could make a video on it" hook. */
  suggestedAngle: string;
}

/** Grounded trend research for a project, produced on demand by OpenAI web search. */
export interface TrendResearch {
  trends: Trend[];
  /** ISO timestamp of when this research was produced. */
  updatedAt?: string;
}

// ---- v2 virality engine ---------------------------------------------------

/**
 * Repo intelligence: the uniquely shareable "proof" extracted from a builder's
 * GitHub. This is the raw material for high-performing Proof-Drop / Hot-Take hooks.
 */
export interface Proof {
  /** Who feels the pain / who we want as a user (the target audience). */
  targetUser: string;
  /** The real-world, non-technical problem or desire the product speaks to. */
  problemSpace: string;
  /** The before -> after the product delivers for that user. */
  transformation: string;
  /** 3-6 relatable/cultural conversations the product can credibly ride. */
  topics: string[];
  /** Hard, screenshot-worthy proof points (numbers, demos, before/after). */
  receipts: string[];
  /** The single most differentiated thing about this work. */
  uniqueAngle: string;
  /** The build story in one or two lines. */
  story: string;
  /** The strongest single "screenshot this" fact - fuels a Proof-Drop hook. */
  bestProofDrop: string;
}

/** A trending / content-gap topic surfaced by the web-search research agent. */
export interface TrendTopic {
  topic: string;
  whyTrending: string;
  whereDiscussed: string;
  sourceUrls: string[];
  /** True when this is a content GAP (searched a lot, few videos) - blue ocean. */
  contentGap?: boolean;
}

/** A mined pattern from a top-performing analogous video (cited, not downloaded). */
export interface ReferencePattern {
  title: string;
  url: string;
  hookType: string;
  format: string;
  /** Beat skeleton / structure of the reference. */
  structure: string;
  whyShareable: string;
}

export type HookArchetype =
  | "hot-take"
  | "proof-drop"
  | "action-start"
  | "trend-reference"
  | "unanswerable-question";

export type EmotionalTrigger =
  | "fear"
  | "empathy"
  | "outrage"
  | "curiosity"
  | "humor"
  | "aspiration";

/** The virality rubric breakdown (each 0-100), plus a weighted total. */
export interface ViralityScore {
  total: number;
  hook: number;
  emotion: number;
  shareability: number;
  saveability: number;
  trendFit: number;
  /** How directly this speaks to the target user's real problem (product fit). */
  relevance: number;
}

/** A scored, rankable content angle - the core output of the research engine. */
export interface Angle {
  id: string;
  title: string;
  /** The recommended opening hook line. */
  hook: string;
  /** 3-5 hook variations to A/B. */
  hookOptions: string[];
  hookArchetype: HookArchetype;
  emotionalTrigger: EmotionalTrigger;
  coreIdea: string;
  whyShareable: string;
  /** Which piece of the builder's proof this rides. */
  proofUsed: string;
  format: string;
  targetDurationSeconds: number;
  score: ViralityScore;
  /** One-line rationale for the predicted performance. */
  why: string;
  sources: string[];
}

/**
 * Persisted research output for a project (stored in the repurposed
 * `trend_research` JSONB column). Topics come from the shared daily cache;
 * proof is repo-specific.
 */
/** Scored angles cached per chosen topic (or freeform prompt) within a project. */
export interface SavedAngleSet {
  /** "topic:<lower>" or "freeform:<lower>" - identifies which selection this is. */
  key: string;
  topic?: TrendTopic | null;
  freeformPrompt?: string | null;
  angles: Angle[];
  references: ReferencePattern[];
  updatedAt: string;
}

export interface ResearchOutput {
  proof: Proof | null;
  topics: TrendTopic[];
  /** Scored angle sets, cached per topic so revisiting never re-calls the model. */
  angleSets?: SavedAngleSet[];
  /** The last-viewed angle-set key, used to restore the view on return. */
  lastKey?: string;
  updatedAt?: string;
}

/** One filmable scene in a generated script. */
export interface Scene {
  id: string;
  /** What the creator says on camera / voiceover for this scene. */
  spokenLine: string;
  /** Exactly one on-screen overlay phrase for this scene, or null. */
  overlay: { text: string; style: "pop" | "subtle" | "stat" } | null;
  /** Optional b-roll / screen-recording cue for this scene. */
  brollCue?: string;
}

/** A full generated script: ordered scenes + a rough total runtime. */
export interface ScriptOutput {
  scenes: Scene[];
  estimatedSeconds: number;
}

/** A timestamped on-screen text moment detected in a reference video. */
export interface OnScreenText {
  /** Seconds from the start of the clip. */
  atSeconds: number;
  text: string;
}

/**
 * Structured breakdown of a reference video.
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
  /**
   * Why this angle was chosen - explicitly references the trend research and the
   * actual source URLs it rides. This is what makes the brief "grounded".
   */
  rationale: string;
  /** The single feeling the video should leave the viewer with. */
  targetFeeling: string;
  /** Source URLs (from trend research) this brief is grounded in. */
  sources: string[];
}

/**
 * A piece of information the AI needs to write a concrete, personal brief but
 * that the GitHub profile cannot provide (motivation, metrics, demo specifics,
 * the creator's take on the trend, etc.). Surfaced as a question to the creator.
 */
export interface InfoGap {
  id: string;
  /** The question to ask the creator. */
  question: string;
  /** Why this is needed / what it unlocks in the video. */
  why: string;
  /** Optional example answer to guide the creator. */
  placeholder?: string;
}

/** One filmable scene in the content brief. */
export interface BriefScene {
  /** 1-based scene number. */
  scene: number;
  /** Short label, e.g. "Hook", "The problem", "Demo", "Payoff". */
  label: string;
  /** Exact words to say on camera / voiceover. */
  spokenLine: string;
  /** On-screen text overlay (empty string if none). */
  onScreenText: string;
  /** What to film / show / do on screen (b-roll, screen recording, action). */
  brollCue: string;
  /** Rough duration for this scene in seconds. */
  durationSeconds?: number;
}

/**
 * The scene-by-scene content brief shown on stage 04. Grounded in the chosen
 * trend, the builder profile, the reference clip's proven structure, and the
 * creator's answers to the info-gap questions.
 */
export interface BriefDoc {
  title: string;
  /** The first ~3 seconds hook. */
  hook: string;
  /** One-line creative angle. */
  angle: string;
  /** The single feeling the video should leave behind. */
  targetFeeling?: string;
  /** Ordered, filmable scenes. */
  scenes: BriefScene[];
  /** Assumptions the AI made where an answer was missing (clearly marked). */
  assumptions?: string[];
  /** Source URLs (from trend research) this brief rides. */
  sources?: string[];
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
  /** Latest research output (proof + topics) for this project. */
  research: ResearchOutput | null;
  /** ISO timestamp of the last research run. */
  researchUpdatedAt: string | null;
  createdAt: string;
}

/** A persisted brief row (blend of a project + a reference video). */
export interface Brief {
  id: string;
  projectId: string;
  referenceVideoId: string | null;
  content: ContentBrief | null;
  /** The scene-by-scene content brief (new stage-04 deliverable). */
  doc: BriefDoc | null;
  /** Info-gap questions the AI asked for this brief. */
  gaps: InfoGap[] | null;
  /** The creator's answers, keyed by question id. */
  answers: Record<string, string> | null;
  /** Render job id, once a render has been kicked off. */
  renderJobId: string | null;
  /** Latest status from the render worker. */
  renderStatus: string | null;
  /** Public URL of the finished edited MP4 (persisted to our Storage). */
  renderUrl: string | null;
  createdAt: string;
}

/**
 * A persisted script row: the same brief rendered twice - a grounded version
 * (grounded research + reference structure + persona) and a deliberately naive
 * generic baseline - so the two can be shown side-by-side.
 */
export interface Script {
  id: string;
  briefId: string;
  grounded: ScriptOutput | null;
  generic: ScriptOutput | null;
  createdAt: string;
}

export type ReferenceAnalysisStatus = "pending" | "analyzing" | "analyzed" | "error";

export interface ReferenceVideo {
  id: string;
  /** Canonical TikTok URL. */
  url: string;
  /** Direct downloadable video URL from the source platform (may expire). */
  downloadUrl: string | null;
  /** TikTok cover/thumbnail image URL (may expire). */
  thumbnailUrl: string | null;
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

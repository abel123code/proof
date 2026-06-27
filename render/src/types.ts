// Types for the render half. Kept local so render/ stays a self-contained deploy unit.

/** Raw word from Whisper (verbose_json, word granularity). Times are SECONDS. */
export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

/** Caption/cut-internal word. Times are MILLISECONDS. Matches Yoda's AutoSubtitle shape. */
export interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

/** A span of the ORIGINAL recording timeline to keep, in ms. */
export interface KeepSegment {
  startMs: number;
  endMs: number;
}

/** A phrase flagged in the script to get an on-screen overlay when spoken (scripts.keyword_flags). */
export interface KeywordFlag {
  phrase: string;
  emphasis?: string;
}

export type OverlayType = "text-card" | "image" | "architecture-diagram";

/** A larger visual overlay (diagram / image / text card), anchored to a keyword or a ratio. */
export interface OverlaySpec {
  type: OverlayType;
  content: string;
  anchor: { kind: "keyword"; keyword: string } | { kind: "ratio"; at: number };
  durationMs?: number;
}

/** The brief the render consumes (produced by the Exa/OpenAI half, or seeded for tests). */
export interface RenderBrief {
  script: string;
  keywordFlags: KeywordFlag[];
  overlays?: OverlaySpec[];
  /** Optional brand accent for captions/overlays. Omit for the neutral default. */
  accentColor?: string;
}

/** A keyword overlay placed on the cut timeline. */
export interface KeywordCue {
  phrase: string;
  startMs: number;
  endMs: number;
  emphasis?: string;
}

/** A big overlay placed on the cut timeline. */
export interface OverlayCue {
  type: OverlayType;
  content: string;
  startMs: number;
  endMs: number;
}

/** Props handed to the Remotion <Main> composition. All times are cut-timeline ms. */
export interface RenderProps {
  baseVideoFile: string;
  durationMs: number;
  /** Pixel dimensions of the cut base video (probed via ffprobe), so the composition matches its aspect. */
  width: number;
  height: number;
  words: Word[];
  keywordCues: KeywordCue[];
  overlayCues: OverlayCue[];
  accentColor?: string;
}

/** One render request. Either a captureId (load from DB) or a direct videoUrl + brief (tests). */
export interface RenderJobInput {
  captureId?: string;
  videoUrl?: string;
  /** Multiple per-scene clips to concatenate (in order) into one take before rendering. */
  videoUrls?: string[];
  brief?: RenderBrief;
}

export type JobStatus =
  | "queued"
  | "transcribing"
  | "cutting"
  | "rendering"
  | "uploading"
  | "done"
  | "error";

export interface JobState {
  id: string;
  status: JobStatus;
  mp4Url?: string;
  error?: string;
  /** The renders-table row id, once created. */
  renderId?: string;
  startedAt: number;
  updatedAt: number;
}

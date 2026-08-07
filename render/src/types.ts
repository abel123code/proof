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
  emphasis?: boolean;
}

export type VisualTemplate =
  | "hook"
  | "keyword"
  | "metric"
  | "comparison"
  | "steps"
  | "quote"
  | "payoff";

export interface VisualCue {
  template: VisualTemplate;
  headline: string;
  startMs: number;
  endMs: number;
  sceneIndex: number;
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

/**
 * A per-project assets folder (the "connect repo -> extract brand/UI" idea). Optional; the
 * premium scene generator embeds these so bespoke scenes can show the real product UI, logos
 * and brand palette instead of generic overlays.
 */
export interface RenderAssets {
  /** URLs (or local paths) of screenshots / logos / UI captures to fetch into the workdir. */
  images?: string[];
  /** Brand accent, e.g. "#d9ff45". Falls back to RenderBrief.accentColor. */
  brandColor?: string;
  /** A sentence or two of brand voice/tone (mined from README / site) to steer copy. */
  brandVoice?: string;
  /** A recurring visual motif to carry across scenes (the "continuity" lever). */
  motif?: string;
  /**
   * What each image actually depicts, keyed by the filename the worker stages it under.
   * Without this the planner sees only opaque UUIDs and cannot tell whether any asset proves a
   * given claim, so it requests visuals that were never uploaded.
   */
  imageDescriptions?: Record<string, string>;
}

export interface RenderBriefScene {
  label: string;
  spokenLine: string;
  onScreenText: string;
  brollCue: string;
  durationSeconds?: number;
}

/** The brief the render worker consumes, produced by the web app or seeded for tests. */
export interface RenderBrief {
  script: string;
  keywordFlags: KeywordFlag[];
  overlays?: OverlaySpec[];
  /** Optional brand accent for captions/overlays. Omit for the neutral default. */
  accentColor?: string;
  /** Optional assets folder for the premium (bespoke-scene) path. */
  assets?: RenderAssets;
  hook?: string;
  targetFeeling?: string;
  scenes?: RenderBriefScene[];
}

export type EditMode = "brief-driven" | "classic" | "generated-experimental";

export type SceneMode = "overlay" | "full-frame";
export type SceneBackgroundTreatment = "footage" | "black";

export interface CreativeDirection {
  backgroundColor: string;
  textColor: string;
  emphasisColor: string;
  successColor: string;
  failureColor: string;
  displayStyle: string;
  technicalStyle: string;
  transitionStyle: string;
  motif: string;
}

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export interface EditCoverage {
  overlayMs: number;
  fullFrameMs: number;
  cleanMs: number;
  overlayRatio: number;
  fullFrameRatio: number;
  cleanRatio: number;
}

export interface EditPlan {
  creativeDirection: CreativeDirection;
  scenes: SceneSpec[];
  cleanIntervals: TimeInterval[];
  coverage: EditCoverage;
}

/** One bespoke scene the premium path storyboards, anchored to the cut timeline. */
export interface SceneSpec {
  /** Stable id, e.g. "scene-1"; used as the HyperFrames composition id + output filename. */
  id: string;
  /** When this scene starts on the CUT timeline, in ms (anchored to a real word boundary). */
  anchorMs: number;
  /** How long the scene plays, in ms. */
  durMs: number;
  /** Whether the speaker remains visible or the visual owns the complete frame. */
  mode: SceneMode;
  /** Whether the compositor keeps the source footage or hard-cuts it to black behind this scene. */
  backgroundTreatment?: SceneBackgroundTreatment;
  /** Planner importance used only by deterministic budget enforcement. */
  priority: number;
  /** Human-readable reason the planner selected this visual mode. */
  rationale: string;
  /** Optional presentation metadata used by stricter authoring-contract experiments. */
  visualPurpose?: string;
  headline?: string;
  supportingVisual?: string;
  /** The recurring motif to honor (shared across scenes for continuity). */
  motif: string;
  /** What this beat should visually convey — the authoring prompt for this scene. */
  intent: string;
  /** The words spoken during this scene (context for the author + QA models). */
  captionText: string;
}

/**
 * Whether a QA finding is an OBJECTIVE safety fault (breaks the talking head or hides the captions —
 * drives an auto-repair) or a SUBJECTIVE editorial note (a creative/copy/polish preference — the
 * HUMAN decides, it NEVER blocks shipping). This split is the core of the auditable QA model: the
 * agent may only auto-act on `safety`; everything `subjective` is surfaced, never silently applied
 * or used to omit a scene. See DECISIONS.md 2026-07-23 (auditable QA advisor).
 */
export type SceneIssueKind = "safety" | "subjective";
export interface SceneIssue {
  /** One concrete, human-readable observation/edit (the "why" behind a verdict). */
  text: string;
  kind: SceneIssueKind;
}

/** Tagged result of the vision-QA pass on one rendered scene. */
export type SceneQAOutcome =
  | "approved" // ship it, no issues
  | "editorial_reject" // has issue(s) — see `issues` and their kinds
  | "operational_error"; // empty/unparseable QA response: retry the JUDGMENT on the same render
export interface SceneQA {
  outcome: SceneQAOutcome;
  /** Tagged findings. Empty when approved. Safety issues drive repair; subjective ones never block. */
  issues: SceneIssue[];
}

/** A scene ALWAYS ships now (never silently omitted). `clean` = QA had nothing; `flagged` = it
 *  shipped carrying unresolved issue(s) the user should see; `base_fallback` = the only non-ship
 *  case, where the scene could not be rendered safely at all (e.g. HTML failed the security
 *  validator) so its window shows the captioned base. */
export type SceneVerdict = "clean" | "flagged" | "base_fallback";

/** The auditable record that travels with every scene and is surfaced to the user: what shipped,
 *  the QA verdict, and the exact reasoning behind it. This is what powers "explain why, then ask
 *  the human whether to re-render." */
export interface SceneReport {
  sceneId: string;
  anchorMs: number;
  durMs: number;
  mode?: SceneMode;
  backgroundTreatment?: SceneBackgroundTreatment;
  rationale?: string;
  intent: string;
  verdict: SceneVerdict;
  /** True unless the scene fell back to base (could not be rendered safely). */
  shipped: boolean;
  /** The unresolved findings at ship time — the reasoning the user reads. Empty when `clean`. */
  issues: SceneIssue[];
  /** How many author/patch rounds it took. */
  attempts: number;
}

/** A scene after authoring — HTML composition, (once rendered) its alpha MOV path, and the
 *  auditable report. `movPath` is present unless the verdict is `base_fallback`. */
export interface AuthoredScene {
  spec: SceneSpec;
  html: string;
  movPath?: string;
  report: SceneReport;
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
  visualCues: VisualCue[];
  accentColor?: string;
}

/** One render request. Either a captureId (load from DB) or a direct videoUrl + brief (tests). */
export interface RenderJobInput {
  jobId?: string;
  briefId?: string;
  captureId?: string;
  videoUrl?: string;
  /** Multiple per-scene clips to concatenate (in order) into one take before rendering. */
  videoUrls?: string[];
  brief?: RenderBrief;
  /**
   * Premium tier: generate bespoke per-beat scenes (GPT storyboard -> HyperFrames HTML ->
   * vision-QA loop) instead of the 3 fixed Remotion overlays. Costs more credits + minutes.
   * Falls back to the fixed-component render if premium generation fails.
   */
  premium?: boolean;
  /** Explicit editor mode. `premium` remains as a backwards-compatible alias. */
  editMode?: EditMode;
}

export type JobStatus =
  | "queued"
  | "transcribing"
  | "cutting"
  | "planning"
  | "rendering"
  | "quality-checking"
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

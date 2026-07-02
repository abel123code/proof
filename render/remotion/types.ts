// Local mirror of the render prop shapes, kept inside the Remotion tree so the
// composition bundles cleanly without reaching into ../src.

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

export interface KeywordCue {
  phrase: string;
  startMs: number;
  endMs: number;
  emphasis?: string;
}

export type OverlayType = "text-card" | "image" | "architecture-diagram";

export interface OverlayCue {
  type: OverlayType;
  content: string;
  startMs: number;
  endMs: number;
}

// A type alias (not interface) so it satisfies Remotion's `Record<string, unknown>` prop bound.
export type RenderProps = {
  baseVideoFile: string;
  durationMs: number;
  width: number;
  height: number;
  words: Word[];
  keywordCues: KeywordCue[];
  overlayCues: OverlayCue[];
  /** Caption/overlay accent. Omit for the neutral default; set per project to brand it. */
  accentColor?: string;
};

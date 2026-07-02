import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { AutoSubtitle } from "./AutoSubtitle";
import { KeywordOverlay } from "./KeywordOverlay";
import { DiagramOverlay } from "./DiagramOverlay";
import { DEFAULT_ACCENT } from "./tokens";
import type { RenderProps } from "./types";

/**
 * Captions + overlays on the cut timeline.
 *
 * When `baseVideoFile` is empty (the default render path) this renders a TRANSPARENT
 * graphics layer only — no <OffthreadVideo>, so there is nothing to seek and the render
 * can't hit "No frame found at position". ffmpeg then burns this layer onto the cut clip.
 *
 * When `baseVideoFile` is set, it composites everything in one pass (useful in Studio /
 * on Linux where OffthreadVideo seeking is reliable).
 */
export const Main: React.FC<RenderProps> = ({
  baseVideoFile,
  words,
  keywordCues,
  overlayCues,
  accentColor,
}) => {
  const accent = accentColor || DEFAULT_ACCENT;
  return (
    <AbsoluteFill style={baseVideoFile ? { backgroundColor: "#000000" } : undefined}>
      {baseVideoFile ? <OffthreadVideo src={staticFile(baseVideoFile)} /> : null}
      <DiagramOverlay cues={overlayCues} accent={accent} />
      <KeywordOverlay cues={keywordCues} accent={accent} />
      <AutoSubtitle words={words} accent={accent} />
    </AbsoluteFill>
  );
};

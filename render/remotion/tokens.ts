// Design tokens for the proof render.

// Default caption/overlay accent. A neutral warm highlight that reads well over ANY
// footage — NOT a brand color. Each project can override it via brief.accentColor.
export const DEFAULT_ACCENT = "#FFD54A"; // warm yellow, the classic short-form caption pop
export const INK = "#FFFFFF";

// Karaoke caption pill (adapted from Yoda's AutoSubtitle styling).
export const SUBTITLE = {
  bg: "rgba(10, 14, 20, 0.72)",
  text: "#FFFFFF",
  padV: 12,
  padH: 28,
  radius: 14,
  fontSize: 44,
  bottomOffset: 260, // px from bottom — clears the lower-third safe zone
} as const;

// Caption page grouping (verbatim from Yoda).
export const CAPTION = {
  maxWords: 7,
  maxChars: 34,
  gapFlushMs: 360,
} as const;

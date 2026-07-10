import type { KeepSegment, WhisperWord, Word } from "./types.js";

/** Shortest caption window that survives a 30fps frame boundary (~4 frames). */
const MIN_WORD_MS = 120;

export interface RemapResult {
  /** Kept words, timestamps rewritten onto the post-cut timeline (ms). */
  words: Word[];
  /** Total duration of the cut clip (ms) = sum of kept-segment durations. */
  totalMs: number;
  /** Map an original-timeline ms to cut-timeline ms; null if it lands in a removed gap. */
  origToCut: (origMs: number) => number | null;
}

/**
 * Rewrite kept-word timestamps from the original recording timeline onto the post-cut
 * timeline. Concatenating segments shifts everything left by the removed gaps, so every
 * caption + overlay cue must be expressed in cut-time or it will drift.
 */
export function remap(keptWords: WhisperWord[], segments: KeepSegment[]): RemapResult {
  const offsets: number[] = [];
  let acc = 0;
  for (const seg of segments) {
    offsets.push(acc);
    acc += seg.endMs - seg.startMs;
  }
  const totalMs = acc;

  const origToCut = (origMs: number): number | null => {
    for (let k = 0; k < segments.length; k++) {
      const seg = segments[k];
      if (origMs >= seg.startMs && origMs <= seg.endMs) {
        return offsets[k] + (origMs - seg.startMs);
      }
    }
    return null;
  };

  const words: Word[] = [];
  for (const w of keptWords) {
    const startMs = origToCut(w.start * 1000);
    if (startMs === null) continue; // shouldn't happen — kept words live inside segments
    const endMs = origToCut(w.end * 1000) ?? startMs + 200;
    words.push({ text: w.word.trim(), startMs, endMs });
  }

  // whisper-1 emits zero-length words (start === end, observed on clip-final words).
  // AutoSubtitle highlights a word while `startMs <= ms < endMs`, so a zero-length word
  // is never highlighted. Widen it to MIN_WORD_MS, but never past the next word's start.
  for (let i = 0; i < words.length; i++) {
    const floor = words[i].startMs + MIN_WORD_MS;
    const ceiling = i + 1 < words.length ? words[i + 1].startMs : totalMs;
    words[i].endMs = Math.max(words[i].endMs, Math.min(floor, ceiling));
  }

  return { words, totalMs, origToCut };
}

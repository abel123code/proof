import type { KeepSegment, WhisperWord } from "./types.js";

/**
 * Non-lexical fillers — sounds that are essentially never meaningful words.
 * Deliberately conservative: we do NOT auto-drop "like", "you know", "basically",
 * "literally" etc. Without context they too often carry meaning, and a wrong cut
 * reads worse than a kept filler. Under-cut beats mangling the sentence.
 */
const FILLERS = new Set([
  "um", "umm", "ummm", "uhm", "uh", "uhh", "uhhh",
  "er", "err", "erm", "eh", "ah", "hmm", "mhm", "mm", "mmm",
]);

function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

export interface CutPlan {
  /** Original-timeline spans to keep (ms), merged + back-to-back-ready for ffmpeg. */
  segments: KeepSegment[];
  /** Words surviving filler removal (original timeline, seconds) — drives caption remap. */
  keptWords: WhisperWord[];
}

export interface CutOptions {
  /** Gaps between kept words <= this stay (natural rhythm). Above it = dead air, cut out. */
  mergeGapMs?: number;
  /** Breathing room kept at each segment edge. */
  padMs?: number;
  /** Cap on a single word's duration — trailing silence beyond this is treated as a gap. */
  maxWordMs?: number;
}

/**
 * MVP cut engine — two passes:
 *   1. Filler removal: drop non-lexical filler tokens.
 *   2. Dead-space trim: keep gaps <= mergeGapMs (natural pauses); split + drop anything
 *      longer, leaving only `padMs` of breath on each side. Adjacent kept speech merges
 *      into one segment, so the segment count stays low (one per real pause).
 *
 * Script-guided retake removal (pass 3) is layered on separately as a stretch.
 */
export function planCut(words: WhisperWord[], opts: CutOptions = {}): CutPlan {
  const mergeGapMs = opts.mergeGapMs ?? 450;
  const padMs = opts.padMs ?? 90;
  const maxWordMs = opts.maxWordMs ?? 650;

  // Whisper often absorbs trailing silence INTO a word's end time, hiding the pause from a
  // gap test. Cap each word's duration so swallowed silence becomes a visible gap + gets cut.
  const keptWords = words
    .filter((w) => !FILLERS.has(norm(w.word)))
    .map((w) => ({ ...w, end: Math.min(w.end, w.start + maxWordMs / 1000) }));
  if (keptWords.length === 0) return { segments: [], keptWords: [] };

  const segments: KeepSegment[] = [];
  let segStart = Math.max(0, keptWords[0].start * 1000 - padMs);
  let prevEnd = keptWords[0].end * 1000;

  for (let i = 1; i < keptWords.length; i++) {
    const s = keptWords[i].start * 1000;
    const e = keptWords[i].end * 1000;
    if (s - prevEnd > mergeGapMs) {
      segments.push({ startMs: segStart, endMs: prevEnd + padMs });
      segStart = Math.max(0, s - padMs);
    }
    prevEnd = e;
  }
  segments.push({ startMs: segStart, endMs: prevEnd + padMs });

  return { segments, keptWords };
}

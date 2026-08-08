import type { Word } from "../types.js";

/** One spoken word on the SCENE's clock: 0 is the moment the scene starts. */
export interface SceneWord {
  text: string;
  /** Milliseconds after the scene begins. Never negative. */
  atMs: number;
}

/**
 * The words spoken during one scene, timed against that scene's own start.
 *
 * The transcript has carried per-word timings all along and `runPremium` already holds them, but
 * they stopped at the planner: the author was given the scene's words as one string plus a
 * duration, so it had no way to know that "Gradescope" lands 2.3 seconds in. It divided the
 * duration into beats instead, and reveals fired against nothing in particular.
 *
 * Times are rebased because the author writes a GSAP timeline starting at 0. Absolute transcript
 * times would be unusable; rebasing is what makes "reveal this row at 1240ms" mean the same thing
 * to the author and to the finished video.
 *
 * A word counts as belonging to a scene when MOST of it is spoken inside the window. Straddling
 * words would otherwise appear in both neighbours, and a reveal would fire against a word the
 * viewer already heard in the previous scene.
 */
export function sceneWords(words: Word[], anchorMs: number, durMs: number): SceneWord[] {
  const end = anchorMs + durMs;
  const out: SceneWord[] = [];
  for (const word of words) {
    const overlap = Math.min(word.endMs, end) - Math.max(word.startMs, anchorMs);
    if (overlap <= 0) continue;

    // A zero-length word would divide by zero; treat it as belonging nowhere rather than everywhere.
    const span = word.endMs - word.startMs;
    if (span <= 0) continue;
    if (overlap * 2 < span) continue;

    out.push({ text: word.text, atMs: Math.max(0, word.startMs - anchorMs) });
  }
  return out;
}

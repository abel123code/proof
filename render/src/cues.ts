import type { KeywordCue, KeywordFlag, OverlayCue, OverlaySpec, Word } from "./types.js";

function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(phrase: string): string[] {
  return phrase.split(/\s+/).map(norm).filter(Boolean);
}

/** Find the first cut-time span where `phrase` is spoken (consecutive word match). */
function findPhrase(words: Word[], phrase: string): { startMs: number; endMs: number } | null {
  const target = tokenize(phrase);
  if (target.length === 0) return null;
  const norms = words.map((w) => norm(w.text));
  for (let i = 0; i + target.length <= norms.length; i++) {
    let hit = true;
    for (let j = 0; j < target.length; j++) {
      if (norms[i + j] !== target[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      return { startMs: words[i].startMs, endMs: words[i + target.length - 1].endMs };
    }
  }
  return null;
}

/** One keyword chip per flagged phrase, anchored to where it's spoken (cut-time). */
export function buildKeywordCues(words: Word[], flags: KeywordFlag[]): KeywordCue[] {
  const cues: KeywordCue[] = [];
  for (const flag of flags) {
    const hit = findPhrase(words, flag.phrase);
    if (!hit) continue;
    cues.push({
      phrase: flag.phrase,
      startMs: hit.startMs,
      endMs: hit.endMs + 900, // linger after the phrase finishes
      emphasis: flag.emphasis,
    });
  }
  return cues;
}

/** Big overlays (diagram / image / text card), anchored to a keyword hit or a ratio. */
export function buildOverlayCues(
  words: Word[],
  overlays: OverlaySpec[],
  totalMs: number,
): OverlayCue[] {
  const cues: OverlayCue[] = [];
  for (const ov of overlays) {
    const dur = ov.durationMs ?? 2500;
    let startMs: number | null = null;
    if (ov.anchor.kind === "keyword") {
      const hit = findPhrase(words, ov.anchor.keyword);
      if (hit) startMs = hit.startMs;
    } else {
      startMs = Math.max(0, Math.min(1, ov.anchor.at)) * totalMs;
    }
    if (startMs === null) continue;
    cues.push({
      type: ov.type,
      content: ov.content,
      startMs,
      endMs: Math.min(totalMs, startMs + dur),
    });
  }
  return cues;
}

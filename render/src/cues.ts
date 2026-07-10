import type { KeywordCue, KeywordFlag, OverlayCue, OverlaySpec, Word } from "./types.js";

function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(phrase: string): string[] {
  return phrase.split(/\s+/).map(norm).filter(Boolean);
}

/**
 * Find the first cut-time span where `phrase` is spoken.
 *
 * Matching is done on the CONCATENATED normalized text, not token-by-token, because
 * cleanTerms merges word pairs ("ai" + "seo" -> "AI SEO", "trigger" + "dev" ->
 * "Trigger.dev"). A token-wise match breaks the moment the transcript and the flag
 * disagree on where the word boundaries are, and the cue is then silently dropped.
 * Comparing "aiseo" to "aiseo" makes split and merged forms both anchor.
 */
function findPhrase(words: Word[], phrase: string): { startMs: number; endMs: number } | null {
  const target = tokenize(phrase).join("");
  if (target.length === 0) return null;
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < words.length; j++) {
      acc += norm(words[j].text);
      if (acc === target) return { startMs: words[i].startMs, endMs: words[j].endMs };
      // Stop as soon as this run can no longer become the target — keeps "ai" from
      // matching inside "aisle" and bounds the inner loop.
      if (!target.startsWith(acc)) break;
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

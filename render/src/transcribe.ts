import { createReadStream } from "node:fs";
import { getOpenAI } from "./openai.js";
import type { WhisperWord } from "./types.js";

/**
 * Build a compact vocabulary hint for whisper from the WHOLE script (not a prefix).
 * Whisper only reads ~224 prompt tokens and treats it as a dictionary, so we extract the
 * terms it actually mishears — product names (Next.js, Trigger.dev), acronyms (SUTD, API),
 * internal-caps names (eDimension) — plus the user's keyword flags, deduped and capped.
 * A vocabulary list (vs a script prefix) reaches late-script terms and doesn't bias
 * decoding toward early lines the speaker may have skipped or reworded.
 */
export function scriptToVocabPrompt(script?: string, keywordPhrases: string[] = []): string | undefined {
  const terms = new Set<string>();
  for (const p of keywordPhrases) {
    const t = p.trim();
    if (t) terms.add(t);
  }
  if (script) {
    // dotted product names, ALLCAPS acronyms (2+), internal-caps names (eDimension, iOS)
    const re = /\b([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9.]*|[A-Z]{2,}|[a-z][A-Za-z]*[A-Z][A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g;
    for (const m of script.matchAll(re)) terms.add(m[1]);
  }
  if (terms.size === 0) return undefined;
  // Cap the joined list (whisper reads ~224 tokens ~= 900 chars).
  let out = "";
  for (const t of terms) {
    const next = out ? `${out}, ${t}` : t;
    if (next.length > 900) break;
    out = next;
  }
  return out || undefined;
}

/**
 * Word-level transcription via whisper-1.
 *
 * whisper-1 is REQUIRED here: it is the only OpenAI model that returns word-level
 * timestamps (verbose_json + timestamp_granularities:["word"]). The gpt-4o-transcribe
 * family does not emit per-word timing, so it can't drive the cut/caption pipeline.
 *
 * `scriptPrompt` biases whisper toward names/technical terms it tends to mishear. Pass a
 * compact VOCABULARY hint (see `scriptToVocabPrompt`), not raw script — whisper only reads
 * ~224 prompt tokens and treats it as a dictionary, so we cap the joined list at ~900 chars.
 *
 * Pass an AUDIO file (extract it first with ffmpeg) — keeps it well under the 25MB limit.
 */
export async function transcribeWords(
  audioPath: string,
  scriptPrompt?: string,
): Promise<WhisperWord[]> {
  const client = getOpenAI();
  const prompt = scriptPrompt?.trim().slice(0, 900);
  const resp = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    language: "en", // force English — Whisper otherwise mis-detects accented English (e.g. as Malay)
    ...(prompt ? { prompt } : {}),
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const words = (resp as unknown as { words?: WhisperWord[] }).words;
  if (!words || words.length === 0) {
    throw new Error(
      "whisper-1 returned no word-level timestamps. Confirm response_format='verbose_json' and timestamp_granularities=['word'].",
    );
  }
  return words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
}

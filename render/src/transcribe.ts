import { createReadStream } from "node:fs";
import { getOpenAI } from "./openai.js";
import type { WhisperWord } from "./types.js";

/**
 * Word-level transcription via whisper-1.
 *
 * whisper-1 is REQUIRED here: it is the only OpenAI model that returns word-level
 * timestamps (verbose_json + timestamp_granularities:["word"]). The gpt-4o-transcribe
 * family does not emit per-word timing, so it can't drive the cut/caption pipeline.
 *
 * Pass an AUDIO file (extract it first with ffmpeg) — keeps it well under the 25MB limit.
 */
export async function transcribeWords(audioPath: string): Promise<WhisperWord[]> {
  const client = getOpenAI();
  const resp = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    language: "en", // force English — Whisper otherwise mis-detects accented English (e.g. as Malay)
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

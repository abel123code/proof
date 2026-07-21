// Load-bearing check (PRD risk #1): confirm whisper-1 returns word-level timestamps
// in the shape the cut engine expects. Run: npm run verify:whisper [path-to-media]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAudio } from "../src/ffmpeg.js";
import { transcribeWords } from "../src/transcribe.js";

const SAMPLE = process.argv[2];

if (!SAMPLE) {
  console.error("usage: npm run verify:whisper -- <path-to-media>");
  process.exit(1);
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "proof-whisper-"));
  const audio = join(dir, "audio.mp3");
  try {
    console.log(`extracting audio from: ${SAMPLE}`);
    await extractAudio(SAMPLE, audio);

    console.log("transcribing with whisper-1 (word granularity)...");
    const words = await transcribeWords(audio);

    console.log(`\n✓ got ${words.length} words. First 12:`);
    for (const w of words.slice(0, 12)) {
      console.log(`  ${w.start.toFixed(2)}s -> ${w.end.toFixed(2)}s  "${w.word}"`);
    }
    const last = words[words.length - 1];
    console.log(`\nlast word ends at ${last.end.toFixed(2)}s`);
    console.log("shape OK: { word, start, end } in seconds.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("verify-whisper FAILED:", e);
  process.exit(1);
});
